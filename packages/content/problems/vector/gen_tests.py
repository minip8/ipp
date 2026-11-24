"""Regenerates tests.json deterministically.

There is no Python reference solution for this C++-only problem: expected values come from a
small model of the specified Vector semantics as seen through the harness (harness.cpp):
growth doubles the capacity (0 -> 1 -> 2 -> 4 ...), reserve(n) reallocates to exactly n when
n > capacity, a copy has capacity == size, a moved-from vector is empty with capacity 0, and
every element operation is counted exactly. After a copy assignment the target's capacity is
unspecified, so the model marks it unknown and the generator avoids anything that depends on it
(growth, capacity, reserve, heapBlocks) until the slot gets a known capacity again.
"""
import json, random, pathlib

here = pathlib.Path(__file__).parent
SLOTS = 4
MAX_CALLS = 2500


class Model:
    def __init__(self):
        self.slots = {}  # slot -> [values, capacity or None]
        self.n_copies = 0
        self.n_moves = 0

    def _held(self, s):
        assert s in self.slots, f"slot {s} holds no Vector"
        return self.slots[s]

    def _grow_if_full(self, s):
        v = self._held(s)
        assert v[1] is not None, "growth on a slot with unknown capacity"
        if len(v[0]) == v[1]:
            self.n_moves += len(v[0])
            v[1] = 1 if v[1] == 0 else 2 * v[1]

    def create(self, s):
        self.slots[s] = [[], 0]

    def pushCopy(self, s, x):
        self._grow_if_full(s)
        self.n_copies += 1
        self.slots[s][0].append(x)

    def pushMove(self, s, x):
        self._grow_if_full(s)
        self.n_moves += 1
        self.slots[s][0].append(x)

    def emplace(self, s, x):
        self._grow_if_full(s)
        self.slots[s][0].append(x)
        return x

    def pushOwn(self, s, i):
        x = self._held(s)[0][i]
        self._grow_if_full(s)
        self.n_copies += 1
        self.slots[s][0].append(x)

    def pop(self, s):
        self._held(s)[0].pop()

    def get(self, s, i):
        vals = self._held(s)[0]
        assert 0 <= i < len(vals)
        return vals[i]

    def at(self, s, i):
        vals = self._held(s)[0]
        return vals[i] if 0 <= i < len(vals) else -1

    def size(self, s):
        return len(self._held(s)[0])

    def capacity(self, s):
        c = self._held(s)[1]
        assert c is not None
        return c

    def reserve(self, s, n):
        v = self._held(s)
        assert v[1] is not None
        if n > v[1]:
            self.n_moves += len(v[0])
            v[1] = n

    def clear(self, s):
        self._held(s)[0].clear()

    def contents(self, s):
        return list(self._held(s)[0])

    def copyConstruct(self, a, b):
        assert a != b
        vals = list(self._held(a)[0])
        self.n_copies += len(vals)
        self.slots[b] = [vals, len(vals)]

    def copyAssign(self, a, b):
        va, vb = self._held(a), self._held(b)
        if a == b:
            return
        self.n_copies += len(va[0])
        self.slots[b] = [list(va[0]), None]

    def moveConstruct(self, a, b):
        assert a != b
        v = self._held(a)
        self.slots[b] = [v[0], v[1]]
        self.slots[a] = [[], 0]

    def moveAssign(self, a, b):
        va, vb = self._held(a), self._held(b)
        if a == b:
            return
        self.slots[b] = [va[0], va[1]]
        self.slots[a] = [[], 0]

    def destroy(self, s):
        self._held(s)
        del self.slots[s]

    def destroyAll(self):
        self.slots.clear()

    def alive(self):
        return sum(len(v[0]) for v in self.slots.values())

    def copies(self):
        return self.n_copies

    def moves(self):
        return self.n_moves

    def heapBlocks(self):
        assert all(v[1] is not None for v in self.slots.values())
        return sum(1 for v in self.slots.values() if v[1] > 0)

    def errors(self):
        return []


def case(id, hidden, ops, explanation=None, check_end=True):
    ops = list(ops)
    if check_end:
        ops += [("destroyAll", []), ("alive", []), ("heapBlocks", []), ("errors", [])]
    assert len(ops) <= MAX_CALLS, (id, len(ops))
    m = Model()
    expected = [getattr(m, name)(*args) for name, args in ops]
    t = {"id": id, "hidden": hidden, "ctorArgs": [],
         "calls": [{"method": n, "args": a} for n, a in ops], "expected": expected}
    if explanation:
        t["explanation"] = explanation
    return t


def op(name, *args):
    return (name, list(args))


def random_ops(rng, n, max_len=40):
    m = Model()
    ops = []
    for s in range(SLOTS):
        ops.append(op("create", s))
        m.create(s)
    for _ in range(n):
        known = [s for s in m.slots if m.slots[s][1] is not None]
        nonempty = [s for s in m.slots if m.slots[s][0]]
        held = sorted(m.slots)
        choices = ["size", "contents", "alive", "copies", "moves"]
        small_known = [s for s in known if len(m.slots[s][0]) < max_len]
        if small_known:
            choices += ["pushCopy", "pushMove", "emplace"] * 3 + ["reserve", "capacity"]
        if [s for s in nonempty if s in small_known]:
            choices += ["pushOwn"]
        if nonempty:
            choices += ["pop", "pop", "get", "at"]
        if len(held) >= 1:
            choices += ["copyConstruct", "copyAssign", "moveConstruct", "moveAssign", "clear", "create"]
        if all(v[1] is not None for v in m.slots.values()):
            choices += ["heapBlocks"]
        c = rng.choice(choices)
        x = rng.randint(0, 10**6)
        if c in ("pushCopy", "pushMove", "emplace"):
            o = op(c, rng.choice(small_known), x)
        elif c == "pushOwn":
            s = rng.choice([s for s in nonempty if s in small_known])
            o = op(c, s, rng.randrange(len(m.slots[s][0])))
        elif c == "reserve":
            s = rng.choice(small_known)
            o = op(c, s, rng.randint(0, max_len))
        elif c == "capacity":
            o = op(c, rng.choice(known))
        elif c == "pop":
            o = op(c, rng.choice(nonempty))
        elif c == "get":
            s = rng.choice(nonempty)
            o = op(c, s, rng.randrange(len(m.slots[s][0])))
        elif c == "at":
            s = rng.choice(held)
            o = op(c, s, rng.randint(-2, len(m.slots[s][0]) + 2))
        elif c in ("copyConstruct", "moveConstruct"):
            a = rng.choice(held)
            o = op(c, a, rng.choice([s for s in range(SLOTS) if s != a]))
        elif c in ("copyAssign", "moveAssign"):
            a, b = rng.choice(held), rng.choice(held)
            if c == "copyAssign" and a == b:
                continue  # self copy-assignment may or may not count copies; tested separately
            o = op(c, a, b)
        elif c in ("clear", "size", "contents", "create"):
            o = op(c, rng.choice(held) if c != "create" else rng.randrange(SLOTS))
        else:
            o = op(c)
        getattr(m, o[0])(*o[1])
        ops.append(o)
    return ops


P = lambda s, x: op("pushCopy", s, x)
M = lambda s, x: op("pushMove", s, x)
E = lambda s, x: op("emplace", s, x)

tests = [
    case("s1-growth", False, [
        op("create", 0), op("capacity", 0), op("heapBlocks"),
        M(0, 10), op("capacity", 0), M(0, 11), op("capacity", 0), M(0, 12), op("capacity", 0),
        op("moves"), op("copies"), op("contents", 0), op("alive"),
    ], "Capacity doubles 0 -> 1 -> 2 -> 4. Moves: 3 for the pushed values plus 1 + 2 for relocating "
       "existing elements when the vector grew from 1 to 2 and from 2 to 4. Nothing is ever copied."),
    case("s2-copy-push-emplace", False, [
        op("create", 0), op("reserve", 0, 4), op("capacity", 0), P(0, 1), M(0, 2), E(0, 3),
        op("copies"), op("moves"), op("at", 0, 2), op("at", 0, 3), op("at", 0, -1), op("pop", 0),
        op("size", 0), op("capacity", 0), op("alive"),
    ], "With enough capacity reserved, push_back(const T&) copies once, push_back(T&&) moves once and "
       "emplace_back constructs in place. at() throws std::out_of_range past the end (reported as -1)."),
    case("s3-copy-and-move-vector", False, [
        op("create", 0), E(0, 5), E(0, 6), E(0, 7), op("copyConstruct", 0, 1), op("capacity", 1),
        op("copies"), op("moveConstruct", 1, 2), op("size", 1), op("capacity", 1), op("contents", 2),
        op("moves"), op("heapBlocks"), op("alive"),
    ], "A copy has capacity == size and copies each element once. Moving a Vector steals its storage: "
       "no element is copied or moved and the source is left empty with capacity 0."),

    case("h-empty", True, [
        op("create", 0), op("size", 0), op("capacity", 0), op("heapBlocks"), op("contents", 0),
        op("at", 0, 0), op("clear", 0), op("reserve", 0, 0), op("capacity", 0), op("heapBlocks"),
        op("copyConstruct", 0, 1), op("capacity", 1), op("heapBlocks"), op("moveConstruct", 1, 2),
        op("moveAssign", 2, 0), op("size", 0), op("heapBlocks"),
    ], "An empty vector allocates nothing; neither does copying or moving one."),
    case("h-no-default-construct", True, [
        op("create", 0), op("reserve", 0, 100), op("alive"), op("capacity", 0), op("heapBlocks"),
        E(0, 1), op("alive"), op("size", 0),
    ], "reserve must not construct any element: only the one emplaced element is alive."),
    case("h-growth-sequence", True,
         [op("create", 0)] + [x for k in range(40) for x in (E(0, k), op("capacity", 0))] +
         [op("moves"), op("copies"), op("heapBlocks")]),
    case("h-growth-moves-not-copies", True,
         [op("create", 0)] + [P(0, k) for k in range(33)] + [op("copies"), op("moves"), op("alive")],
         "33 copy-pushes copy exactly 33 times; every relocation moves (1+2+4+8+16+32 = 63 moves)."),
    case("h-reserve", True, [
        op("create", 0), E(0, 1), E(0, 2), E(0, 3), op("capacity", 0), op("reserve", 0, 3),
        op("capacity", 0), op("moves"), op("reserve", 0, 10), op("capacity", 0), op("moves"),
        op("reserve", 0, 5), op("capacity", 0), op("contents", 0), op("heapBlocks"),
        E(0, 4), E(0, 5), E(0, 6), E(0, 7), E(0, 8), E(0, 9), E(0, 10), op("capacity", 0), E(0, 11),
        op("capacity", 0), op("moves"),
    ], "reserve(n) reallocates to exactly n only when n > capacity, moving each element once."),
    case("h-pop-destroys", True, [
        op("create", 0), E(0, 1), E(0, 2), E(0, 3), op("pop", 0), op("alive"), op("pop", 0),
        op("pop", 0), op("alive"), op("capacity", 0), E(0, 4), op("contents", 0), op("alive"),
    ], "pop_back destroys the last element; the slot is reused by the next push."),
    case("h-clear", True, [
        op("create", 0), E(0, 1), E(0, 2), E(0, 3), E(0, 4), E(0, 5), op("clear", 0), op("alive"),
        op("size", 0), op("capacity", 0), op("heapBlocks"), E(0, 6), op("contents", 0), op("clear", 0),
        op("clear", 0), op("alive"),
    ], "clear destroys every element but keeps the storage."),
    case("h-destructor", True, [
        op("create", 0), E(0, 1), E(0, 2), E(0, 3), op("create", 1), E(1, 4), op("alive"),
        op("heapBlocks"), op("destroy", 0), op("alive"), op("heapBlocks"), op("destroy", 1),
        op("alive"), op("heapBlocks"), op("errors"),
    ], "The destructor destroys each element once and frees the storage.", check_end=False),
    case("h-at", True, [
        op("create", 0), op("at", 0, 0), E(0, 7), E(0, 8), op("at", 0, 0), op("at", 0, 1),
        op("at", 0, 2), op("at", 0, -1), op("at", 0, 1000000), op("get", 0, 1),
    ]),
    case("h-push-own-element", True, [
        op("create", 0), E(0, 1), op("pushOwn", 0, 0), op("pushOwn", 0, 1), op("capacity", 0),
        op("pushOwn", 0, 0), op("pushOwn", 0, 2), op("contents", 0), op("copies"), op("moves"),
        op("errors"),
    ], "push_back(v[i]) must work even when it reallocates: the argument refers into the old storage."),
    case("h-push-own-full", True,
         [op("create", 0)] + [E(0, 100 + k) for k in range(8)] +
         [op("pushOwn", 0, 7), op("pushOwn", 0, 0), op("contents", 0), op("copies"), op("errors")]),
    case("h-emplace-forwards", True, [
        op("create", 0), E(0, 1), E(0, 2), E(0, 3), op("copies"), op("moves"), op("errors"),
    ], "emplace_back perfectly forwards its arguments into a single in-place construction."),
    case("h-copy-construct", True, [
        op("create", 0), M(0, 1), M(0, 2), M(0, 3), M(0, 4), M(0, 5), op("copyConstruct", 0, 1),
        op("contents", 1), op("capacity", 1), op("copies"), op("alive"), M(1, 6), op("capacity", 1),
        op("contents", 0), op("heapBlocks"),
    ], "The copy is independent of the original."),
    case("h-copy-assign", True, [
        op("create", 0), E(0, 1), E(0, 2), E(0, 3), op("create", 1), E(1, 9), E(1, 8), E(1, 7), E(1, 6),
        E(1, 5), op("copyAssign", 0, 1), op("contents", 1), op("alive"), op("copies"), op("moves"),
        op("copyAssign", 1, 0), op("contents", 0), op("create", 2), op("copyAssign", 2, 1),
        op("size", 1), op("alive"), op("copies"),
    ], "Copy assignment copies each element of the source once and destroys what the target held."),
    case("h-self-copy-assign", True, [
        op("create", 0), E(0, 1), E(0, 2), E(0, 3), op("copyAssign", 0, 0), op("contents", 0),
        op("size", 0), op("alive"), op("errors"),
    ], "v = v must leave v unchanged."),
    case("h-move-assign", True, [
        op("create", 0), E(0, 1), E(0, 2), op("create", 1), E(1, 3), E(1, 4), E(1, 5),
        op("moveAssign", 0, 1), op("contents", 1), op("capacity", 1), op("size", 0), op("capacity", 0),
        op("alive"), op("moves"), op("copies"), op("heapBlocks"), E(0, 6), op("contents", 0),
    ], "Move assignment destroys the target's elements, steals the source's storage and leaves the "
       "source empty with capacity 0, without moving any element."),
    case("h-self-move-assign", True, [
        op("create", 0), E(0, 1), E(0, 2), E(0, 3), op("moveAssign", 0, 0), op("contents", 0),
        op("capacity", 0), op("alive"), op("heapBlocks"),
    ], "v = std::move(v) must leave v unchanged."),
    case("h-moved-from-reusable", True, [
        op("create", 0), E(0, 1), E(0, 2), op("moveConstruct", 0, 1), E(0, 3), P(0, 4),
        op("contents", 0), op("capacity", 0), op("contents", 1), op("moveAssign", 1, 0),
        op("contents", 0), op("contents", 1), M(1, 5), op("contents", 1),
    ], "A moved-from Vector is empty and fully usable."),
    case("h-large", True,
         [op("create", 0)] + [M(0, k) for k in range(1500)] +
         [op("size", 0), op("capacity", 0), op("moves"), op("copies"), op("get", 0, 0),
          op("get", 0, 777), op("get", 0, 1499), op("copyConstruct", 0, 1), op("copies"),
          op("heapBlocks")] + [op("pop", 1) for _ in range(500)] +
         [op("size", 1), op("capacity", 1), op("alive")]),
]
rng = random.Random(1979)
for k, n in enumerate([40, 60, 100, 150, 200, 300, 400]):
    tests.append(case(f"h-rand-{k}", True, random_ops(rng, n)))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
