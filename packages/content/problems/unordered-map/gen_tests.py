"""Regenerates tests.json deterministically.

There is no Python reference solution for this C++-only problem: expected values come from a
small model of the specified HashMap semantics as seen through the harness (harness.cpp):
separate chaining with bucket index hash(key) % bucket_count(); no buckets until the first
insertion (or rehash/reserve), then 8, doubling whenever an insertion would make
size() > bucket_count(); rehash(n) grows to exactly max(n, size()) and never shrinks; a copy
(constructed or assigned) has the source's bucket count; a moved-from map has no buckets; one
heap block per element plus one for the bucket array. Every Key/Val copy and move is counted.
The test's constructor argument picks the hash: 0 is the identity, 1 sends every key to bucket 0.
Self copy-assignment may or may not copy (both are allowed), so nothing that counts copies
follows one.
"""
import json, random, pathlib

here = pathlib.Path(__file__).parent
SLOTS = 4
MAX_CALLS = 3000


class Map:
    def __init__(self, d=None, bc=0):
        self.d = dict(d or {})
        self.bc = bc


class Model:
    def __init__(self, mode):
        self.mode = mode
        self.slots = {}
        self.n_copies = 0
        self.n_moves = 0

    def h(self, k):
        return 0 if self.mode == 1 else k

    def _held(self, s):
        assert s in self.slots, f"slot {s} holds no HashMap"
        return self.slots[s]

    def _grow_for_one(self, m):
        if len(m.d) + 1 > m.bc:
            m.bc = 8 if m.bc == 0 else 2 * m.bc

    # Each op returns the harness method's result (None for void).
    def create(self, s):
        self.slots[s] = Map()

    def insert(self, s, k, v):
        m = self._held(s)
        if k in m.d:
            return False
        self._grow_for_one(m)
        self.n_copies += 2
        m.d[k] = v
        return True

    def tryEmplace(self, s, k, v):
        m = self._held(s)
        if k in m.d:
            return False
        self._grow_for_one(m)
        self.n_moves += 1  # the key; the value is built in place from (v, Label{})
        m.d[k] = v
        return True

    def subscript(self, s, k, v, rvalue):
        m = self._held(s)
        if k in m.d:
            old = m.d[k]
        else:
            self._grow_for_one(m)
            if rvalue:
                self.n_moves += 1
            else:
                self.n_copies += 1
            old = 0
        m.d[k] = v
        return old

    def at(self, s, k):
        return self._held(s).d.get(k, -1)

    def find(self, s, k):
        return self._held(s).d.get(k, -1)

    def contains(self, s, k):
        return k in self._held(s).d

    def erase(self, s, k):
        m = self._held(s)
        if k in m.d:
            del m.d[k]
            return 1
        return 0

    def size(self, s):
        return len(self._held(s).d)

    def bucketCount(self, s):
        return self._held(s).bc

    def bucketOf(self, s, k):
        m = self._held(s)
        assert m.bc > 0
        return self.h(k) % m.bc

    def bucketSize(self, s, i):
        m = self._held(s)
        assert 0 <= i < m.bc
        return sum(1 for k in m.d if self.h(k) % m.bc == i)

    def rehash(self, s, n):
        m = self._held(s)
        n = max(n, len(m.d))
        if n > m.bc:
            m.bc = n

    def reserve(self, s, n):
        self.rehash(s, n)

    def clear(self, s):
        self._held(s).d.clear()

    def contents(self, s):
        return [f"{k}={v}" for k, v in sorted(self._held(s).d.items())]

    def copyConstruct(self, a, b):
        assert a != b
        m = self._held(a)
        self.n_copies += 2 * len(m.d)
        self.slots[b] = Map(m.d, m.bc)

    def copyAssign(self, a, b):
        m, _ = self._held(a), self._held(b)
        if a == b:
            return
        self.n_copies += 2 * len(m.d)
        self.slots[b] = Map(m.d, m.bc)

    def moveConstruct(self, a, b):
        assert a != b
        self.slots[b] = self._held(a)
        self.slots[a] = Map()

    def moveAssign(self, a, b):
        m, _ = self._held(a), self._held(b)
        if a == b:
            return
        self.slots[b] = m
        self.slots[a] = Map()

    def destroy(self, s):
        self._held(s)
        del self.slots[s]

    def destroyAll(self):
        self.slots.clear()

    def alive(self):
        return 2 * sum(len(m.d) for m in self.slots.values())

    def copies(self):
        return self.n_copies

    def moves(self):
        return self.n_moves

    def heapBlocks(self):
        return sum(len(m.d) + (1 if m.bc > 0 else 0) for m in self.slots.values())

    def errors(self):
        return []


def case(id, hidden, mode, ops, explanation=None, check_end=True):
    ops = list(ops)
    if check_end:
        ops += [("destroyAll", []), ("alive", []), ("heapBlocks", []), ("errors", [])]
    assert len(ops) <= MAX_CALLS, (id, len(ops))
    m = Model(mode)
    expected = [getattr(m, name)(*args) for name, args in ops]
    t = {"id": id, "hidden": hidden, "ctorArgs": [mode],
         "calls": [{"method": n, "args": a} for n, a in ops], "expected": expected}
    if explanation:
        t["explanation"] = explanation
    return t


def op(name, *args):
    return (name, list(args))


I = lambda s, k, v: op("insert", s, k, v)


def random_ops(rng, mode, n, key_range):
    m = Model(mode)
    ops = []
    for s in range(SLOTS):
        ops.append(op("create", s))
        m.create(s)
    while len(ops) < n:
        held = sorted(m.slots)
        with_buckets = [s for s in held if m.slots[s].bc > 0]
        c = rng.choice(["insert"] * 5 + ["tryEmplace"] * 3 + ["subscript"] * 3 + ["erase"] * 4 +
                       ["find", "at", "contains", "size", "bucketCount", "contents", "alive", "copies",
                        "moves", "heapBlocks", "rehash", "reserve", "clear", "copyConstruct", "copyAssign",
                        "moveConstruct", "moveAssign", "create"] +
                       (["bucketOf", "bucketSize"] if with_buckets else []))
        k = rng.randrange(key_range)
        v = rng.randint(1, 10**6)
        s = rng.choice(held)
        if c in ("insert", "tryEmplace"):
            o = op(c, s, k, v)
        elif c == "subscript":
            o = op(c, s, k, v, rng.random() < 0.5)
        elif c in ("erase", "find", "at", "contains"):
            if c == "erase" and m.slots[s].d and rng.random() < 0.7:
                k = rng.choice(sorted(m.slots[s].d))
            o = op(c, s, k)
        elif c in ("size", "bucketCount", "contents", "clear"):
            if c == "clear" and rng.random() < 0.6:
                continue  # keep the maps reasonably full
            o = op(c, s)
        elif c in ("rehash", "reserve"):
            o = op(c, s, rng.randint(0, 2 * len(m.slots[s].d) + 20))
        elif c == "bucketOf":
            o = op(c, rng.choice(with_buckets), k)
        elif c == "bucketSize":
            s = rng.choice(with_buckets)
            o = op(c, s, rng.randrange(m.slots[s].bc))
        elif c in ("copyConstruct", "moveConstruct"):
            o = op(c, s, rng.choice([t for t in range(SLOTS) if t != s]))
        elif c in ("copyAssign", "moveAssign"):
            t = rng.choice(held)
            if c == "copyAssign" and s == t:
                continue  # self copy-assignment may or may not copy; tested on its own
            o = op(c, s, t)
        elif c == "create":
            o = op(c, rng.randrange(SLOTS))
        else:
            o = op(c)
        getattr(m, o[0])(*o[1])
        ops.append(o)
    return ops


tests = [
    case("s1-basics", False, 0, [
        op("create", 0), op("bucketCount", 0), op("heapBlocks"), I(0, 1, 10), op("bucketCount", 0),
        I(0, 1, 11), op("find", 0, 1), op("tryEmplace", 0, 2, 20), op("subscript", 0, 3, 30, False),
        op("subscript", 0, 3, 31, False), op("at", 0, 3), op("at", 0, 4), op("contains", 0, 2), op("size", 0),
        op("copies"), op("moves"), op("heapBlocks"), op("contents", 0), op("erase", 0, 2), op("erase", 0, 2),
        op("contents", 0),
    ], "An empty map has no buckets; the first insertion creates 8. Inserting an existing key changes "
       "nothing. insert copies the key and the value; try_emplace moves the key and builds the value in "
       "place; operator[] of a new key copies the key and default-constructs the value (0). Each element "
       "is one heap block, plus one for the bucket array."),
    case("s2-growth", False, 0,
         [op("create", 0)] + [I(0, k, 100 + k) for k in range(8)] +
         [op("bucketCount", 0), op("copies"), I(0, 8, 108), op("bucketCount", 0), op("copies"), op("moves"),
          op("heapBlocks"), op("bucketOf", 0, 8), op("bucketSize", 0, 0), op("bucketSize", 0, 8), op("size", 0)],
         "The ninth insertion would make size() > bucket_count(), so the table doubles to 16 buckets. "
         "Rehashing relinks the existing nodes: no key or value is copied or moved (copies() goes up only "
         "by the 2 of the new element), and key 8 now lives in bucket 8 % 16 = 8."),
    case("s3-collisions", False, 1, [
        op("create", 0), I(0, 1, 10), I(0, 2, 20), I(0, 3, 30), I(0, 4, 40), I(0, 5, 50), op("bucketSize", 0, 0),
        op("bucketSize", 0, 1), op("find", 0, 3), op("erase", 0, 3), op("erase", 0, 1), op("erase", 0, 5),
        op("find", 0, 2), op("find", 0, 4), op("find", 0, 3), op("contents", 0), op("bucketSize", 0, 0),
        op("alive"), op("heapBlocks"),
    ], "With hash mode 1 every key hashes to 0, so all elements share bucket 0's chain. Lookups must compare "
       "keys with KeyEqual, and erase must unlink correctly wherever the element is in the chain."),

    case("h-empty-map", True, 0, [
        op("create", 0), op("find", 0, 1), op("at", 0, 1), op("contains", 0, 1), op("erase", 0, 1), op("size", 0),
        op("contents", 0), op("bucketCount", 0), op("clear", 0), op("copyConstruct", 0, 1), op("bucketCount", 1),
        op("heapBlocks"), op("moveConstruct", 1, 2), op("rehash", 0, 0), op("bucketCount", 0), op("heapBlocks"),
        op("reserve", 0, 5), op("bucketCount", 0), op("heapBlocks"), op("contents", 0), op("find", 0, 3),
    ], "Lookups, erase and copies of a map with no buckets must not divide by zero or allocate."),
    case("h-growth-threshold", True, 0,
         [op("create", 0)] + [x for k in range(40) for x in (I(0, 3 * k, k), op("bucketCount", 0))] +
         [op("copies"), op("moves"), op("heapBlocks"), op("size", 0)]),
    case("h-existing-key-no-growth", True, 0,
         [op("create", 0)] + [I(0, k, k) for k in range(8)] +
         [I(0, 3, 99), op("tryEmplace", 0, 4, 99), op("subscript", 0, 5, 55, True), op("bucketCount", 0),
          op("copies"), op("moves"), op("find", 0, 3), op("find", 0, 5), op("errors")],
         "Inserting a key that is already present never grows the table and never copies or moves anything."),
    case("h-rehash-relinks", True, 0,
         [op("create", 0)] + [I(0, 10 * k, k) for k in range(6)] +
         [op("bucketCount", 0), op("bucketSize", 0, 0), op("copies"), op("rehash", 0, 10), op("bucketCount", 0),
          op("bucketSize", 0, 0), op("bucketOf", 0, 30), op("rehash", 0, 25), op("bucketCount", 0),
          op("bucketOf", 0, 30), op("bucketOf", 0, 50), op("bucketSize", 0, 5), op("bucketSize", 0, 0),
          op("copies"), op("moves"), op("heapBlocks"), op("contents", 0), op("alive")],
         "rehash relinks every node into the bucket hash % bucket_count() of the new table, which need not "
         "be a power of two; no element is copied, moved or reallocated."),
    case("h-rehash-rules", True, 0,
         [op("create", 0)] + [I(0, k, k) for k in range(8)] +
         [op("rehash", 0, 3), op("bucketCount", 0), op("rehash", 0, 8), op("bucketCount", 0), op("rehash", 0, 9),
          op("bucketCount", 0), op("reserve", 0, 100), op("bucketCount", 0), op("rehash", 0, 50),
          op("bucketCount", 0), op("heapBlocks"), op("clear", 0), op("bucketCount", 0), op("rehash", 0, 0),
          op("bucketCount", 0), op("heapBlocks")],
         "rehash(n) grows to max(n, size()) buckets only if that is more than now; it never shrinks."),
    case("h-rehash-then-grow", True, 0,
         [op("create", 0), op("rehash", 0, 3), op("bucketCount", 0), op("heapBlocks"), I(0, 7, 1), I(0, 8, 2),
          I(0, 9, 3), op("bucketCount", 0), I(0, 10, 4), op("bucketCount", 0), op("bucketOf", 0, 7),
          op("bucketOf", 0, 9), op("bucketSize", 0, 3), op("bucketSize", 0, 4)],
         "After rehash(3) the table doubles from 3 to 6 when the fourth element arrives."),
    case("h-modulo-not-mask", True, 0,
         [op("create", 0), op("reserve", 0, 10)] + [I(0, k, k) for k in (3, 13, 23, 9, 19, 10)] +
         [op("bucketOf", 0, 13), op("bucketOf", 0, 19), op("bucketOf", 0, 10), op("bucketSize", 0, 3),
          op("bucketSize", 0, 9), op("bucketSize", 0, 0), op("bucketSize", 0, 1), op("find", 0, 23),
          op("find", 0, 19)]),
    case("h-erase-chain", True, 1,
         [op("create", 0)] + [I(0, k, 100 + k) for k in range(1, 9)] +
         [op("erase", 0, 8), op("erase", 0, 1), op("erase", 0, 4), op("erase", 0, 4), op("erase", 0, 42),
          op("size", 0), op("alive"), op("heapBlocks"), op("contents", 0), op("bucketSize", 0, 0),
          I(0, 4, 400), I(0, 1, 101), op("find", 0, 4), op("find", 0, 7), op("contents", 0)] +
         [op("erase", 0, k) for k in (2, 3, 5, 6, 7, 4, 1)] +
         [op("size", 0), op("contents", 0), op("heapBlocks"), op("bucketCount", 0)],
         "Erasing from one long chain: the head, the tail and the middle, then everything."),
    case("h-erase-spread", True, 0,
         [op("create", 0)] + [I(0, k, k) for k in range(20)] +
         [op("erase", 0, k) for k in range(0, 20, 3)] +
         [op("size", 0), op("contents", 0), op("alive"), op("heapBlocks"), op("bucketCount", 0),
          op("find", 0, 3), op("find", 0, 4), op("contains", 0, 18), op("contains", 0, 19)],
         "Erase destroys the key and the value and frees the node; the bucket count stays."),
    case("h-subscript", True, 0, [
        op("create", 0), op("subscript", 0, 5, 50, False), op("copies"), op("moves"), op("subscript", 0, 6, 60, True),
        op("copies"), op("moves"), op("subscript", 0, 5, 51, True), op("subscript", 0, 6, 61, False),
        op("copies"), op("moves"), op("find", 0, 5), op("at", 0, 6), op("alive"), op("heapBlocks"),
    ], "operator[] inserts a default-constructed value for a new key (copying or moving the key) and "
       "returns the existing value otherwise."),
    case("h-try-emplace", True, 0, [
        op("create", 0), op("tryEmplace", 0, 1, 10), op("tryEmplace", 0, 1, 11), op("find", 0, 1), op("moves"),
        op("copies"), op("errors"), op("tryEmplace", 0, 2, 20), op("moves"), op("alive"),
    ], "try_emplace leaves its key argument untouched when the key is present, and forwards its "
       "arguments to build the value in place."),
    case("h-insert-existing", True, 1, [
        op("create", 0), I(0, 1, 10), I(0, 2, 20), op("copies"), I(0, 1, 11), I(0, 2, 22), op("copies"),
        op("find", 0, 1), op("find", 0, 2), op("size", 0), op("alive"),
    ]),
    case("h-clear", True, 0,
         [op("create", 0)] + [I(0, k, k) for k in range(12)] +
         [op("clear", 0), op("size", 0), op("alive"), op("bucketCount", 0), op("heapBlocks"), op("contents", 0),
          op("find", 0, 3), I(0, 3, 33), op("contents", 0), op("clear", 0), op("clear", 0), op("heapBlocks")],
         "clear destroys every element and frees the nodes but keeps the buckets."),
    case("h-copy-construct", True, 0,
         [op("create", 0)] + [I(0, k, 10 * k) for k in range(10)] +
         [op("copies"), op("copyConstruct", 0, 1), op("copies"), op("bucketCount", 1), op("contents", 1),
          op("heapBlocks"), op("subscript", 1, 3, 333, False), op("find", 0, 3), op("erase", 1, 4),
          op("find", 0, 4), op("alive"), op("moves")],
         "A copy has the same bucket count, copies each key and value once, and is independent."),
    case("h-copy-construct-collisions", True, 1,
         [op("create", 0)] + [I(0, k, k) for k in range(6)] +
         [op("copyConstruct", 0, 1), op("bucketSize", 1, 0), op("contents", 1), op("erase", 1, 0),
          op("erase", 1, 5), op("contents", 1), op("contents", 0)]),
    case("h-copy-assign", True, 0,
         [op("create", 0)] + [I(0, k, k) for k in range(3)] + [op("create", 1)] +
         [I(1, k, k) for k in range(100, 120)] +
         [op("copies"), op("copyAssign", 0, 1), op("copies"), op("contents", 1), op("bucketCount", 1),
          op("alive"), op("heapBlocks"), op("create", 2), op("copyAssign", 2, 0), op("contents", 0),
          op("bucketCount", 0), op("heapBlocks"), op("moves")],
         "Copy assignment destroys the target's elements and gives it copies of the source's, with the "
         "source's bucket count."),
    case("h-self-copy-assign", True, 1,
         [op("create", 0)] + [I(0, k, k) for k in range(5)] +
         [op("copyAssign", 0, 0), op("contents", 0), op("size", 0), op("alive"), op("heapBlocks"),
          op("bucketSize", 0, 0), op("errors")],
         "m = m must leave m unchanged."),
    case("h-move", True, 0,
         [op("create", 0)] + [I(0, k, k) for k in range(9)] +
         [op("copies"), op("moveConstruct", 0, 1), op("copies"), op("moves"), op("size", 0), op("bucketCount", 0),
          op("contents", 1), op("bucketCount", 1), op("heapBlocks"), op("create", 2), I(2, 50, 5), I(2, 51, 6),
          op("moveAssign", 1, 2), op("contents", 2), op("alive"), op("heapBlocks"), op("bucketCount", 1),
          I(0, 7, 70), op("bucketCount", 0), op("contents", 0), I(1, 8, 80), op("contents", 1), op("moves")],
         "Moving a map takes over its buckets and nodes without touching any element; the source is "
         "left empty with no buckets, and is still usable."),
    case("h-self-move-assign", True, 0,
         [op("create", 0)] + [I(0, k, k) for k in range(4)] +
         [op("moveAssign", 0, 0), op("contents", 0), op("bucketCount", 0), op("alive"), op("heapBlocks")],
         "m = std::move(m) must leave m unchanged."),
    case("h-destructor", True, 1,
         [op("create", 0)] + [I(0, k, k) for k in range(7)] + [op("create", 1), I(1, 1, 1)] +
         [op("alive"), op("heapBlocks"), op("destroy", 0), op("alive"), op("heapBlocks"), op("destroy", 1),
          op("alive"), op("heapBlocks"), op("errors")],
         "The destructor destroys every element once and frees every node and the bucket array.",
         check_end=False),
    case("h-large", True, 0,
         [op("create", 0)] + [I(0, (k * 7919) % 100003, k) for k in range(1500)] +
         [op("size", 0), op("bucketCount", 0), op("copies"), op("moves"), op("heapBlocks")] +
         [op("erase", 0, (k * 7919) % 100003) for k in range(0, 1500, 2)] +
         [op("size", 0), op("bucketCount", 0), op("find", 0, 7919), op("find", 0, (3 * 7919) % 100003),
          op("copyConstruct", 0, 1), op("copies"), op("heapBlocks"), op("alive")]),
    case("h-large-collisions", True, 1,
         [op("create", 0)] + [I(0, k, k) for k in range(300)] +
         [op("bucketSize", 0, 0), op("bucketCount", 0), op("copies")] +
         [op("erase", 0, (k * 37) % 300) for k in range(300)] +
         [op("size", 0), op("heapBlocks"), op("alive")]),
]
rng = random.Random(1983)
for k, (mode, n, kr) in enumerate([(0, 60, 20), (1, 80, 15), (0, 150, 60), (0, 250, 40), (1, 250, 30),
                                    (0, 400, 200), (0, 600, 100)]):
    tests.append(case(f"h-rand-{k}", True, mode, random_ops(rng, mode, n, kr)))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
