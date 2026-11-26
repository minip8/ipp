"""Regenerates tests.json deterministically.

There is no Python reference solution for this C++-only problem: expected values come from a
small model of the specified InplaceVector<Tracked, 6> semantics as seen through the harness
(harness.cpp). A slot holds the list of its elements' values (-1 once moved from); every Tracked
operation the candidate's code performs is counted by kind, exactly as ops() reports it.
insert(pos, const T&) and self-assignment are not recorded by the harness (their exact operations
are not specified), so they change no counts here.
"""
import json, random, pathlib

here = pathlib.Path(__file__).parent
SLOTS = 4
N = 6
FULL = -4
KINDS = ["construct", "copy-construct", "move-construct", "copy-assign", "move-assign", "destroy"]


class Model:
    def __init__(self):
        self.slots = {}
        self.counts = dict.fromkeys(KINDS, 0)

    def _rec(self, k, n=1):
        self.counts[k] += n

    def _held(self, s):
        assert s in self.slots, f"slot {s} holds no InplaceVector"
        return self.slots[s]

    def _drop(self, s):
        """optional<InplaceVector>::emplace / reset: destroys the vector already in the slot."""
        if s in self.slots:
            self._rec("destroy", len(self.slots[s]))
            del self.slots[s]

    def create(self, s):
        self._drop(s)
        self.slots[s] = []

    def _push(self, s, v, kind):
        xs = self._held(s)
        if len(xs) == N:
            return False
        self._rec(kind)
        xs.append(v)
        return True

    def pushCopy(self, s, v):
        return self._push(s, v, "copy-construct")

    def pushMove(self, s, v):
        return self._push(s, v, "move-construct")

    def emplace(self, s, v):
        return v if self._push(s, v, "construct") else FULL

    def tryPushCopy(self, s, v):
        return self._push(s, v, "copy-construct")

    def tryPushMove(self, s, v):
        return self._push(s, v, "move-construct")

    def pop(self, s):
        xs = self._held(s)
        assert xs
        xs.pop()
        self._rec("destroy")

    def insertMove(self, s, i, v):
        xs = self._held(s)
        assert 0 <= i <= len(xs)
        if len(xs) == N:
            return FULL
        if i == len(xs):
            self._rec("move-construct")
        else:
            self._rec("move-construct")              # old last element into the raw slot at end()
            self._rec("move-assign", len(xs) - 1 - i)  # shift [i, end - 1) right by one
            self._rec("move-assign")                 # the value into *pos
        xs.insert(i, v)
        return i

    def insertCopy(self, s, i, v):
        xs = self._held(s)
        assert 0 <= i <= len(xs)
        if len(xs) == N:
            return FULL
        xs.insert(i, v)
        return i

    def insertOwn(self, s, i, j):
        xs = self._held(s)
        assert 0 <= j < len(xs)
        return self.insertCopy(s, i, xs[j])

    def erase(self, s, i):
        xs = self._held(s)
        assert 0 <= i < len(xs)
        self._rec("move-assign", len(xs) - 1 - i)
        self._rec("destroy")
        del xs[i]
        return i

    def eraseRange(self, s, i, j):
        xs = self._held(s)
        assert 0 <= i <= j <= len(xs)
        if i < j:
            self._rec("move-assign", len(xs) - j)
            self._rec("destroy", j - i)
        del xs[i:j]
        return i

    def get(self, s, i):
        xs = self._held(s)
        assert 0 <= i < len(xs)
        return xs[i]

    def size(self, s):
        return len(self._held(s))

    def clear(self, s):
        xs = self._held(s)
        self._rec("destroy", len(xs))
        xs.clear()

    def contents(self, s):
        return list(self._held(s))

    def copyConstruct(self, a, b):
        assert a != b
        src = list(self._held(a))
        self._drop(b)
        self._rec("copy-construct", len(src))
        self.slots[b] = src

    def _assign(self, a, b, assign, construct):
        src, dst = self._held(a), self._held(b)
        m, n = len(dst), len(src)
        self._rec(assign, min(m, n))
        if n > m:
            self._rec(construct, n - m)
        if m > n:
            self._rec("destroy", m - n)
        self.slots[b] = list(src)

    def copyAssign(self, a, b):
        self._held(a), self._held(b)
        if a != b:
            self._assign(a, b, "copy-assign", "copy-construct")

    def moveConstruct(self, a, b):
        assert a != b
        src = self._held(a)
        vals = list(src)
        self._drop(b)
        self._rec("move-construct", len(vals))
        self.slots[b] = vals
        self.slots[a] = [-1] * len(vals)

    def moveAssign(self, a, b):
        self._held(a), self._held(b)
        if a == b:
            return
        n = len(self.slots[a])
        self._assign(a, b, "move-assign", "move-construct")
        self.slots[a] = [-1] * n

    def destroy(self, s):
        self._held(s)
        self._drop(s)

    def destroyAll(self):
        for s in sorted(self.slots):
            self._drop(s)

    def alive(self):
        return sum(len(xs) for xs in self.slots.values())

    def ops(self):
        out = [k for k in KINDS for _ in range(self.counts[k])]
        self.counts = dict.fromkeys(KINDS, 0)
        return out

    def errors(self):
        return []


def case(id, hidden, ops, explanation=None, check_end=True):
    ops = list(ops)
    if check_end:
        ops += [("destroyAll", []), ("alive", []), ("errors", [])]
    m = Model()
    expected = [getattr(m, name)(*args) for name, args in ops]
    t = {"id": id, "hidden": hidden, "ctorArgs": [],
         "calls": [{"method": n, "args": a} for n, a in ops], "expected": expected}
    if explanation:
        t["explanation"] = explanation
    return t


def op(name, *args):
    return (name, list(args))


def random_ops(rng, n):
    m = Model()
    ops = []
    vals = iter(rng.sample(range(10, 10000), 5000))
    for s in range(SLOTS):
        ops.append(op("create", s))
        m.create(s)
    while len(ops) < n:
        held = sorted(m.slots)
        nonempty = [s for s in held if m.slots[s]]
        c = rng.choice(["pushCopy", "pushMove", "emplace", "tryPushCopy", "tryPushMove"] * 2 +
                       ["insertMove", "insertMove", "insertCopy", "insertOwn", "erase", "erase", "eraseRange",
                        "pop", "get", "size", "contents", "clear", "create", "copyConstruct", "copyAssign",
                        "copyAssign", "moveConstruct", "moveAssign", "moveAssign", "destroy", "alive", "ops", "ops"])
        if not held and c != "create":
            continue
        if c in ("pushCopy", "pushMove", "emplace", "tryPushCopy", "tryPushMove"):
            o = op(c, rng.choice(held), next(vals))
        elif c in ("insertMove", "insertCopy"):
            s = rng.choice(held)
            o = op(c, s, rng.randint(0, len(m.slots[s])), next(vals))
        elif c == "insertOwn":
            if not nonempty:
                continue
            s = rng.choice(nonempty)
            o = op(c, s, rng.randint(0, len(m.slots[s])), rng.randrange(len(m.slots[s])))
        elif c in ("erase", "pop", "get"):
            if not nonempty:
                continue
            s = rng.choice(nonempty)
            o = op(c, s) if c == "pop" else op(c, s, rng.randrange(len(m.slots[s])))
        elif c == "eraseRange":
            s = rng.choice(held)
            i = rng.randint(0, len(m.slots[s]))
            o = op(c, s, i, rng.randint(i, len(m.slots[s])))
        elif c in ("size", "contents", "clear", "destroy"):
            o = op(c, rng.choice(held))
        elif c == "create":
            o = op(c, rng.randrange(SLOTS))
        elif c in ("copyConstruct", "moveConstruct"):
            a = rng.choice(held)
            o = op(c, a, rng.choice([s for s in range(SLOTS) if s != a]))
        elif c in ("copyAssign", "moveAssign"):
            o = op(c, rng.choice(held), rng.choice(held))
        else:
            o = op(c)
        getattr(m, o[0])(*o[1])
        ops.append(o)
    return ops + [op("ops")]


C = lambda *a: op("contents", *a)
OPS = op("ops")


def fill(s, vals, kind="emplace"):
    return [op(kind, s, v) for v in vals]


tests = [
    case("s1-push-and-full", False, [
        op("create", 0), op("size", 0), op("pushCopy", 0, 1), op("pushMove", 0, 2), op("emplace", 0, 3), OPS,
        op("pushMove", 0, 4), op("pushMove", 0, 5), op("pushMove", 0, 6), OPS, op("size", 0), op("pushMove", 0, 7),
        op("emplace", 0, 8), op("tryPushCopy", 0, 9), OPS, C(0), op("pop", 0), op("tryPushMove", 0, 10), C(0),
        OPS, op("alive"),
    ], "push_back copies or moves once and emplace_back constructs in place; there is never a "
       "reallocation. With 6 elements the vector is full: push_back and emplace_back throw std::bad_alloc "
       "(false / -4) and try_push_back returns nullptr (false), all without constructing anything."),
    case("s2-insert-erase", False, [
        op("create", 0)] + fill(0, [10, 20, 30, 40]) + [OPS, op("insertMove", 0, 1, 15), OPS, C(0),
        op("erase", 0, 0), OPS, C(0), op("insertMove", 0, 4, 50), OPS, op("eraseRange", 0, 1, 3), OPS, C(0),
        op("alive"),
    ], "insert(pos, T&&) in the middle move-constructs the last element into the raw slot at end(), "
       "move-assigns the elements in between one place right and move-assigns the value into *pos. "
       "erase move-assigns the following elements one place left and destroys the (moved-from) last one."),
    case("s3-copy-and-move", False, [
        op("create", 0)] + fill(0, [1, 2, 3]) + [op("create", 1)] + fill(1, [7, 8, 9, 10, 11]) + [OPS,
        op("copyAssign", 0, 1), OPS, C(1), op("copyConstruct", 0, 2), OPS, op("moveConstruct", 2, 3), OPS,
        C(2), C(3), op("alive"),
    ], "Copy assignment assigns over the 3 elements both have and destroys the target's other 2. "
       "Moving an InplaceVector moves each element: its storage is inline, so there is nothing to steal, "
       "and the source keeps its 3 (moved-from) elements."),

    case("h-no-default-construct", True, [
        op("create", 0), op("alive"), OPS, op("size", 0), C(0), op("emplace", 0, 1), op("alive"), OPS,
        op("create", 1), op("copyConstruct", 1, 2), op("moveConstruct", 1, 3), op("alive"), OPS, op("errors"),
    ], "An empty InplaceVector has room for 6 elements but constructs none."),
    case("h-inline-storage", True, [
        op("create", 0)] + fill(0, [1, 2, 3]) + [C(0), op("get", 0, 0), op("get", 0, 2), op("errors"),
    ], "The elements live inside the InplaceVector object."),
    case("h-push-full", True, [
        op("create", 0)] + fill(0, [1, 2, 3, 4, 5, 6], "pushCopy") + [OPS, op("pushCopy", 0, 7), op("pushMove", 0, 8),
        op("emplace", 0, 9), op("tryPushCopy", 0, 10), op("tryPushMove", 0, 11), OPS, op("size", 0), C(0),
        op("alive"), op("errors"),
    ], "A full InplaceVector rejects every push without constructing anything; the argument of "
       "push_back(T&&) and try_push_back(T&&) is not moved from."),
    case("h-try-push", True, [
        op("create", 0), op("tryPushCopy", 0, 1), op("tryPushMove", 0, 2), OPS, C(0), op("errors"),
    ]),
    case("h-pop-and-reuse", True, [
        op("create", 0)] + fill(0, [1, 2, 3, 4, 5, 6]) + [op("pop", 0), op("pop", 0), OPS, op("alive"),
        op("emplace", 0, 7), op("emplace", 0, 8), op("emplace", 0, 9), C(0), OPS, op("errors"),
    ], "pop_back destroys the last element; its slot is raw storage again and is reused by the next push."),
    case("h-clear", True, [
        op("create", 0)] + fill(0, [1, 2, 3, 4, 5]) + [OPS, op("clear", 0), OPS, op("size", 0), op("alive"),
        op("clear", 0), OPS] + fill(0, [6, 7, 8, 9, 10, 11]) + [C(0), op("errors"),
    ], "clear destroys each element exactly once."),
    case("h-destructor", True, [
        op("create", 0)] + fill(0, [1, 2, 3]) + [op("create", 1)] + fill(1, [4]) + [op("create", 2), OPS,
        op("destroy", 0), OPS, op("alive"), op("destroy", 2), OPS, op("destroy", 1), OPS, op("alive"), op("errors"),
    ], "The destructor destroys exactly the live elements, once each.", check_end=False),
    case("h-emplace-forwards", True, [
        op("create", 0), op("emplace", 0, 1), op("emplace", 0, 2), OPS, op("errors"),
    ], "emplace_back perfectly forwards its arguments into a single in-place construction."),

    # ---- insert
    case("h-insert-move-positions", True, [
        op("create", 0)] + fill(0, [1, 2, 3, 4, 5]) + [OPS, op("insertMove", 0, 0, 100), OPS, C(0),
        op("pop", 0), op("pop", 0), OPS, op("insertMove", 0, 3, 101), OPS, C(0), op("insertMove", 0, 4, 102),
        OPS, C(0), op("insertMove", 0, 2, 103), op("alive"), op("errors"),
    ], "insert at the front shifts every element; insert at end() just move-constructs; insert into a "
       "full vector throws std::bad_alloc (-4) and changes nothing."),
    case("h-insert-into-empty", True, [
        op("create", 0), op("insertMove", 0, 0, 5), OPS, op("insertMove", 0, 0, 4), OPS, op("insertMove", 0, 1, 6),
        OPS, C(0), op("errors"),
    ]),
    case("h-insert-full", True, [
        op("create", 0)] + fill(0, [1, 2, 3, 4, 5, 6]) + [OPS, op("insertMove", 0, 0, 7), op("insertMove", 0, 6, 8),
        op("insertCopy", 0, 3, 9), op("insertOwn", 0, 0, 5), OPS, C(0), op("alive"), op("errors"),
    ], "Inserting into a full InplaceVector throws std::bad_alloc before touching any element."),
    case("h-insert-copy", True, [
        op("create", 0)] + fill(0, [1, 2, 3]) + [op("insertCopy", 0, 1, 10), C(0), op("insertCopy", 0, 4, 11), C(0),
        op("insertCopy", 0, 0, 12), C(0), op("alive"), op("errors"),
    ], "insert(pos, const T&) gives the same contents as the move version."),
    case("h-insert-own-element", True, [
        op("create", 0)] + fill(0, [1, 2, 3, 4]) + [op("insertOwn", 0, 0, 2), C(0), op("insertOwn", 0, 1, 1), C(0),
        op("create", 1)] + fill(1, [5, 6, 7]) + [op("insertOwn", 1, 1, 2), C(1), op("insertOwn", 1, 4, 0), C(1),
        op("insertOwn", 1, 0, 4), C(1), op("errors"),
    ], "v.insert(pos, v[j]) must insert the value v[j] had before the call, even when the shift moves "
       "or overwrites v[j]."),

    # ---- erase
    case("h-erase-positions", True, [
        op("create", 0)] + fill(0, [1, 2, 3, 4, 5, 6]) + [OPS, op("erase", 0, 5), OPS, op("erase", 0, 0), OPS, C(0),
        op("erase", 0, 2), OPS, C(0), op("alive"), op("erase", 0, 0), op("erase", 0, 0), op("erase", 0, 0), C(0),
        op("errors"),
    ], "Erasing the last element just destroys it; erasing at i move-assigns the size() - 1 - i "
       "elements after it, then destroys the last."),
    case("h-erase-range", True, [
        op("create", 0)] + fill(0, [1, 2, 3, 4, 5, 6]) + [OPS, op("eraseRange", 0, 1, 3), OPS, C(0),
        op("eraseRange", 0, 2, 2), OPS, op("eraseRange", 0, 2, 4), OPS, C(0), op("eraseRange", 0, 0, 2), OPS,
        op("size", 0), op("alive")] + fill(0, [7, 8]) + [op("eraseRange", 0, 0, 2), C(0), op("errors"),
    ], "erase(first, last) move-assigns the elements after last into place and destroys last - first "
       "elements at the end; an empty range does nothing."),
    case("h-erase-then-insert", True, [
        op("create", 0)] + fill(0, [1, 2, 3, 4]) + [op("erase", 0, 1), op("insertMove", 0, 1, 9), C(0),
        op("eraseRange", 0, 0, 4), op("insertMove", 0, 0, 10), C(0), OPS, op("errors"),
    ]),

    # ---- copy and move of the container
    case("h-copy-construct", True, [
        op("create", 0)] + fill(0, [1, 2, 3, 4]) + [OPS, op("copyConstruct", 0, 1), OPS, C(0), C(1), op("pop", 1),
        op("emplace", 1, 9), C(0), C(1), op("alive"), op("errors"),
    ], "The copy constructor copy-constructs each element into the new vector's own storage."),
    case("h-copy-assign-longer", True, [
        op("create", 0)] + fill(0, [1, 2, 3, 4, 5]) + [op("create", 1)] + fill(1, [6, 7]) + [OPS,
        op("copyAssign", 0, 1), OPS, C(1), op("alive"), op("errors"),
    ], "Assigning a longer vector: copy-assign the 2 elements the target has, copy-construct the other 3."),
    case("h-copy-assign-shorter", True, [
        op("create", 0)] + fill(0, [1, 2]) + [op("create", 1)] + fill(1, [6, 7, 8, 9]) + [OPS,
        op("copyAssign", 0, 1), OPS, C(1), op("alive"), op("create", 2), op("copyAssign", 2, 0), OPS, C(0),
        op("errors"),
    ], "Assigning a shorter vector: copy-assign the common elements, destroy the target's surplus."),
    case("h-self-copy-assign", True, [
        op("create", 0)] + fill(0, [1, 2, 3]) + [op("copyAssign", 0, 0), C(0), op("alive"), op("errors"),
    ], "v = v leaves v unchanged."),
    case("h-move-construct", True, [
        op("create", 0)] + fill(0, [1, 2, 3, 4]) + [OPS, op("moveConstruct", 0, 1), OPS, C(1), op("size", 0), C(0),
        op("alive"), op("clear", 0), OPS, op("emplace", 0, 5), C(0), op("errors"),
    ], "The move constructor move-constructs each element; the source keeps its size, holding "
       "moved-from elements, and stays usable."),
    case("h-move-assign", True, [
        op("create", 0)] + fill(0, [1, 2, 3]) + [op("create", 1)] + fill(1, [4]) + [OPS, op("moveAssign", 0, 1), OPS,
        C(1), C(0), op("create", 2)] + fill(2, [5, 6, 7, 8, 9]) + [OPS, op("moveAssign", 1, 2), OPS, C(2), C(1),
        op("alive"), op("errors"),
    ], "Move assignment move-assigns the common elements, then move-constructs the rest or destroys the "
       "surplus; the source keeps its moved-from elements."),
    case("h-self-move-assign", True, [
        op("create", 0)] + fill(0, [1, 2, 3]) + [op("moveAssign", 0, 0), C(0), op("alive"), op("errors"),
    ], "v = std::move(v) leaves v unchanged."),
    case("h-full-copies", True, [
        op("create", 0)] + fill(0, [1, 2, 3, 4, 5, 6]) + [op("copyConstruct", 0, 1), op("moveConstruct", 0, 2),
        op("create", 3), op("copyAssign", 1, 3), OPS, C(1), C(2), C(3), op("pushMove", 3, 7), op("alive"),
        op("errors"),
    ]),
]
rng = random.Random(606)
for k, n in enumerate([40, 60, 100, 150, 250, 400, 600]):
    tests.append(case(f"h-rand-{k}", True, random_ops(rng, n)))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
