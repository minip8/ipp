"""Regenerates tests.json deterministically.

There is no Python reference solution for this C++-only problem: expected values come from a
small model of the specified Function<int(int)> semantics as seen through the harness
(harness.cpp). A slot is absent (no Function), None (an empty Function) or the callable it
holds: an Acc with its running total, a lambda multiplying by k, or the function `twice`. Every
Acc copy and move the statement prescribes is counted, and every non-empty Function owns exactly
one heap block. Self copy-assignment may or may not copy (both are allowed), so nothing that
counts copies follows one.
"""
import json, random, pathlib

here = pathlib.Path(__file__).parent
SLOTS = 6
MAX_CALLS = 300


class Acc:
    def __init__(self, total):
        self.total = total


class Model:
    def __init__(self):
        self.slots = {}  # slot -> None | Acc | ("lambda", k) | "twice"
        self.n_copies = 0
        self.n_moves = 0

    def _held(self, s):
        assert s in self.slots, f"slot {s} holds no Function"
        return self.slots[s]

    def _clone(self, c):
        if isinstance(c, Acc):
            self.n_copies += 1
            return Acc(c.total)
        return c

    # Each op returns the harness method's result (None for void).
    def makeEmpty(self, s):
        self.slots[s] = None

    def makeAcc(self, s, start):
        self.n_moves += 1
        self.slots[s] = Acc(start)

    def makeAccCopy(self, s, start):
        self.n_copies += 1
        self.slots[s] = Acc(start)

    def makeLambda(self, s, k):
        self.slots[s] = ("lambda", k)

    def makeFunction(self, s):
        self.slots[s] = "twice"

    def copyConstruct(self, a, b):
        assert a != b
        self.slots[b] = self._clone(self._held(a))

    def copyAssign(self, a, b):
        src, _ = self._held(a), self._held(b)
        if a != b:
            self.slots[b] = self._clone(src)

    def moveConstruct(self, a, b):
        assert a != b
        self.slots[b] = self._held(a)
        self.slots[a] = None

    def moveAssign(self, a, b):
        src, _ = self._held(a), self._held(b)
        if a != b:
            self.slots[b] = src
            self.slots[a] = None

    def assignAcc(self, s, start):
        self._held(s)
        self.n_moves += 1
        self.slots[s] = Acc(start)

    def assignAccCopy(self, s, start):
        self._held(s)
        self.n_copies += 1
        self.slots[s] = Acc(start)

    def assignNull(self, s):
        self._held(s)
        self.slots[s] = None

    def swap(self, a, b):
        x, y = self._held(a), self._held(b)
        self.slots[a], self.slots[b] = y, x

    def call(self, s, x):
        c = self._held(s)
        if c is None:
            return -1
        if isinstance(c, Acc):
            c.total += x
            return c.total
        if c == "twice":
            return 2 * x
        return x * c[1]

    def isEmpty(self, s):
        return self._held(s) is None

    def destroy(self, s):
        self._held(s)
        del self.slots[s]

    def destroyAll(self):
        self.slots.clear()

    def voidCall(self, x, empty):
        return -1 if empty else 3 * x

    def argCopies(self, x):
        return 0

    def alive(self):
        return sum(1 for c in self.slots.values() if isinstance(c, Acc))

    def copies(self):
        return self.n_copies

    def moves(self):
        return self.n_moves

    def heapBlocks(self):
        return sum(1 for c in self.slots.values() if c is not None)

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


def random_ops(rng, n):
    m = Model()
    ops = []
    nxt = [0]

    def fresh():
        nxt[0] += rng.randint(1, 50) * 10
        return nxt[0]

    while len(ops) < n:
        held = sorted(m.slots)
        choices = ["makeAcc", "makeAcc", "makeAccCopy", "makeEmpty", "makeLambda", "makeFunction"]
        if held:
            choices += ["call"] * 6 + ["isEmpty", "copyConstruct", "copyConstruct", "copyAssign",
                                       "copyAssign", "moveConstruct", "moveAssign", "moveAssign",
                                       "assignAcc", "assignAccCopy", "assignNull", "swap", "destroy",
                                       "alive", "copies", "moves", "heapBlocks"]
        c = rng.choice(choices)
        if c in ("makeAcc", "makeAccCopy"):
            o = op(c, rng.randrange(SLOTS), fresh())
        elif c == "makeEmpty":
            o = op(c, rng.randrange(SLOTS))
        elif c == "makeLambda":
            o = op(c, rng.randrange(SLOTS), rng.randint(2, 9))
        elif c == "makeFunction":
            o = op(c, rng.randrange(SLOTS))
        elif c == "call":
            o = op(c, rng.choice(held), rng.randint(0, 99))
        elif c in ("copyConstruct", "moveConstruct"):
            a = rng.choice(held)
            o = op(c, a, rng.choice([s for s in range(SLOTS) if s != a]))
        elif c == "copyAssign":
            a, b = rng.choice(held), rng.choice(held)
            if a == b:
                continue  # self copy-assignment may or may not copy; tested on its own
            o = op(c, a, b)
        elif c in ("moveAssign", "swap"):
            o = op(c, rng.choice(held), rng.choice(held))
        elif c in ("assignAcc", "assignAccCopy"):
            o = op(c, rng.choice(held), fresh())
        elif c in ("assignNull", "isEmpty", "destroy"):
            o = op(c, rng.choice(held))
        else:
            o = op(c)
        getattr(m, o[0])(*o[1])
        ops.append(o)
    return ops


tests = [
    case("s1-callables", False, [
        op("makeAcc", 0, 10), op("call", 0, 1), op("call", 0, 2), op("makeFunction", 1), op("call", 1, 5),
        op("makeLambda", 2, 3), op("call", 2, 4), op("makeEmpty", 3), op("isEmpty", 3), op("call", 3, 1),
        op("isEmpty", 0), op("moves"), op("copies"), op("heapBlocks"), op("alive"),
    ], "Any callable can be stored: a stateful functor (Acc keeps a running total, so its calls return "
       "11 then 13), a function (twice) and a lambda. Calling an empty Function throws "
       "std::bad_function_call (reported as -1). The Acc was moved once into its Function, and each "
       "non-empty Function owns one heap block."),
    case("s2-copy-is-independent", False, [
        op("makeAcc", 0, 100), op("call", 0, 1), op("copyConstruct", 0, 1), op("copies"), op("call", 1, 10),
        op("call", 0, 1), op("alive"), op("heapBlocks"),
    ], "Copying a Function copies its callable once, including the callable's state at that moment "
       "(101). After that the two totals are independent: 111 in the copy, 102 in the original."),
    case("s3-move-void-args", False, [
        op("makeAcc", 0, 5), op("moveConstruct", 0, 1), op("isEmpty", 0), op("call", 0, 1), op("call", 1, 1),
        op("moves"), op("heapBlocks"), op("voidCall", 4, False), op("voidCall", 4, True), op("argCopies", 7),
    ], "Moving a Function hands over its callable without touching it (still one move in total) and "
       "leaves the source empty. A Function<void(int&)> discards the callable's result and passes the "
       "reference through (4 * 3 = 12). Arguments are forwarded: no Probe is ever copied."),

    case("h-empty", True, [
        op("makeEmpty", 0), op("isEmpty", 0), op("call", 0, 3), op("heapBlocks"), op("copyConstruct", 0, 1),
        op("isEmpty", 1), op("call", 1, 3), op("heapBlocks"), op("makeAcc", 2, 7), op("copyAssign", 0, 2),
        op("isEmpty", 2), op("alive"), op("heapBlocks"), op("moveConstruct", 0, 3), op("isEmpty", 3),
        op("moveAssign", 3, 0), op("isEmpty", 0), op("assignNull", 0), op("swap", 0, 1), op("isEmpty", 1),
        op("errors"),
    ], "Copies and moves of an empty Function are empty and allocate nothing. Copying from a non-const "
       "lvalue must use the copy constructor, not the converting constructor (which would wrap the "
       "empty Function in a non-empty one)."),
    case("h-copy-construct-blocks", True, [
        op("makeAcc", 0, 1), op("copyConstruct", 0, 1), op("heapBlocks"), op("copies"), op("moves"),
        op("copyConstruct", 1, 2), op("copyConstruct", 2, 3), op("heapBlocks"), op("copies"), op("alive"),
        op("call", 3, 5), op("call", 0, 5), op("call", 3, 5),
    ], "Each copy owns exactly one new heap block holding one copy of the callable."),
    case("h-copy-assign", True, [
        op("makeAcc", 0, 1), op("makeAcc", 1, 50), op("call", 1, 1), op("copyAssign", 0, 1), op("alive"),
        op("copies"), op("call", 1, 5), op("call", 0, 1), op("heapBlocks"), op("makeFunction", 2),
        op("copyAssign", 2, 0), op("call", 0, 8), op("alive"), op("makeLambda", 3, 4), op("copyAssign", 1, 3),
        op("call", 3, 2), op("copies"),
    ], "Copy assignment destroys the target's old callable and gives it its own copy of the source's."),
    case("h-self-copy-assign", True, [
        op("makeAcc", 0, 9), op("call", 0, 1), op("copyAssign", 0, 0), op("call", 0, 1), op("alive"),
        op("heapBlocks"), op("isEmpty", 0), op("makeEmpty", 1), op("copyAssign", 1, 1), op("isEmpty", 1),
        op("errors"),
    ], "f = f must leave f holding its callable, with its state."),
    case("h-move-assign", True, [
        op("makeAcc", 0, 3), op("makeAcc", 1, 4), op("moveAssign", 0, 1), op("alive"), op("isEmpty", 0),
        op("call", 1, 1), op("moves"), op("copies"), op("heapBlocks"), op("makeEmpty", 2),
        op("moveAssign", 2, 1), op("isEmpty", 1), op("alive"), op("heapBlocks"),
    ], "Move assignment destroys the target's old callable, takes the source's without moving it, and "
       "leaves the source empty."),
    case("h-self-move-assign", True, [
        op("makeAcc", 0, 20), op("moveAssign", 0, 0), op("isEmpty", 0), op("call", 0, 1), op("alive"),
        op("heapBlocks"), op("moves"), op("makeEmpty", 1), op("moveAssign", 1, 1), op("isEmpty", 1),
        op("errors"),
    ], "f = std::move(f) must leave f unchanged."),
    case("h-moves-never-touch", True, [
        op("makeAcc", 0, 1), op("moveConstruct", 0, 1), op("moveConstruct", 1, 2), op("moveAssign", 2, 0),
        op("moveConstruct", 0, 3), op("moveAssign", 3, 0), op("moves"), op("copies"), op("heapBlocks"),
        op("call", 0, 1), op("alive"), op("isEmpty", 1), op("isEmpty", 2), op("isEmpty", 3),
    ], "Moving a Function transfers its heap block; the callable itself is never moved or copied."),
    case("h-converting-counts", True, [
        op("makeAccCopy", 0, 1), op("copies"), op("moves"), op("alive"), op("makeAcc", 1, 2), op("copies"),
        op("moves"), op("alive"), op("heapBlocks"), op("call", 0, 1), op("call", 1, 1),
    ], "Constructing from an lvalue callable copies it once; from an rvalue, moves it once."),
    case("h-assign-callable", True, [
        op("makeEmpty", 0), op("assignAcc", 0, 30), op("moves"), op("call", 0, 1), op("assignAccCopy", 0, 40),
        op("copies"), op("alive"), op("call", 0, 2), op("assignNull", 0), op("alive"), op("isEmpty", 0),
        op("heapBlocks"), op("call", 0, 2), op("assignAcc", 0, 50), op("call", 0, 5), op("makeLambda", 1, 7),
        op("assignAcc", 1, 60), op("call", 1, 1), op("assignNull", 1), op("assignNull", 1), op("heapBlocks"),
        op("moves"), op("copies"),
    ], "Assigning a callable replaces the old one (destroyed exactly once); = nullptr empties the Function."),
    case("h-state-persists", True,
         [op("makeAcc", 0, 0)] + [op("call", 0, k) for k in range(1, 21)] +
         [op("copyConstruct", 0, 1)] + [op("call", 1, 1) for _ in range(5)] + [op("call", 0, 0), op("alive")],
         "The stored callable is called as a non-const lvalue, so it keeps its state from call to call."),
    case("h-function-and-lambda", True, [
        op("makeFunction", 0), op("call", 0, 21), op("copyConstruct", 0, 1), op("call", 1, 4), op("heapBlocks"),
        op("alive"), op("makeLambda", 2, 5), op("call", 2, 3), op("copyConstruct", 2, 3), op("call", 3, 6),
        op("moveAssign", 2, 0), op("call", 0, 2), op("isEmpty", 2), op("heapBlocks"),
    ], "A function decays to a function pointer; a lambda is stored like any functor."),
    case("h-swap", True, [
        op("makeAcc", 0, 1), op("makeLambda", 1, 2), op("swap", 0, 1), op("call", 0, 10), op("call", 1, 10),
        op("swap", 0, 0), op("call", 0, 1), op("moves"), op("copies"), op("makeEmpty", 2), op("swap", 1, 2),
        op("isEmpty", 1), op("call", 2, 1), op("heapBlocks"), op("alive"),
    ], "swap exchanges the callables without copying, moving or destroying any."),
    case("h-destructor", True, [
        op("makeAcc", 0, 1), op("makeAcc", 1, 2), op("makeAccCopy", 2, 3), op("makeLambda", 3, 4), op("alive"),
        op("heapBlocks"), op("destroy", 1), op("alive"), op("heapBlocks"), op("destroy", 3), op("heapBlocks"),
        op("destroyAll"), op("alive"), op("heapBlocks"), op("errors"),
    ], "Destroying a Function destroys its callable exactly once and frees its block.", check_end=False),
    case("h-replace-in-slot", True, [
        op("makeAcc", 0, 1), op("makeAcc", 0, 2), op("alive"), op("call", 0, 1), op("makeEmpty", 0), op("alive"),
        op("heapBlocks"), op("makeAccCopy", 0, 4), op("makeFunction", 0), op("alive"), op("heapBlocks"),
    ]),
    case("h-void-return", True, [
        op("voidCall", 5, False), op("voidCall", 5, True), op("voidCall", 0, False), op("voidCall", 1000, False),
        op("heapBlocks"), op("errors"),
    ], "Function<void(int&)> discards the callable's result and passes the reference through; an empty one "
       "throws std::bad_function_call."),
    case("h-arg-forwarding", True, [
        op("argCopies", 7), op("argCopies", 8), op("errors"),
    ], "operator() forwards its arguments: a by-value argument is moved along, never copied, and a "
       "reference argument still refers to the caller's object."),
]
rng = random.Random(2011)
for k, n in enumerate([30, 50, 80, 120, 180, 250]):
    tests.append(case(f"h-rand-{k}", True, random_ops(rng, n)))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
