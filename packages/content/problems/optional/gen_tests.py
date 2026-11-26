"""Regenerates tests.json deterministically.

There is no Python reference solution for this C++-only problem: expected values come from a
small model of the specified Optional semantics as seen through the harness (harness.cpp). A slot
is absent (no Optional), EMPTY, or the value of the Tracked it holds (-1 once moved from). Every
Tracked operation the candidate's code performs is counted by kind, exactly as ops() reports it.
Self-assignment is not recorded by the harness, so it changes no counts here.
"""
import json, random, pathlib

here = pathlib.Path(__file__).parent
SLOTS = 4
EMPTY = "empty"
KINDS = ["construct", "copy-construct", "move-construct", "copy-assign", "move-assign", "destroy"]


class Model:
    def __init__(self):
        self.slots = {}
        self.counts = dict.fromkeys(KINDS, 0)

    def _rec(self, k):
        self.counts[k] += 1

    def _held(self, s):
        assert s in self.slots, f"slot {s} holds no Optional"
        return self.slots[s]

    def _drop(self, s):
        """optional<Optional>::emplace / reset: destroys the Optional already in the slot."""
        if self.slots.get(s, EMPTY) != EMPTY:
            self._rec("destroy")
        self.slots.pop(s, None)

    def makeEmpty(self, s):
        self._drop(s)
        self.slots[s] = EMPTY

    def makeCopy(self, s, v):
        self._drop(s)
        self._rec("copy-construct")
        self.slots[s] = v

    def makeMove(self, s, v):
        self._drop(s)
        self._rec("move-construct")
        self.slots[s] = v

    def emplace(self, s, v):
        if self._held(s) != EMPTY:
            self._rec("destroy")
        self._rec("construct")
        self.slots[s] = v
        return v

    def emplaceThrows(self, s, v):
        if self._held(s) != EMPTY:
            self._rec("destroy")
        self.slots[s] = EMPTY
        return True

    def reset(self, s):
        if self._held(s) != EMPTY:
            self._rec("destroy")
        self.slots[s] = EMPTY

    def hasValue(self, s):
        return self._held(s) != EMPTY

    def value(self, s):
        v = self._held(s)
        return -4 if v == EMPTY else v

    def valueOr(self, s, fb):
        v = self._held(s)
        if v == EMPTY:
            self._rec("construct")
            return fb
        self._rec("copy-construct")
        return v

    def copyConstruct(self, a, b):
        assert a != b
        v = self._held(a)
        self._drop(b)
        if v != EMPTY:
            self._rec("copy-construct")
        self.slots[b] = v

    def copyAssign(self, a, b):
        va, vb = self._held(a), self._held(b)
        if a == b:
            return
        if va != EMPTY and vb != EMPTY:
            self._rec("copy-assign")
        elif va != EMPTY:
            self._rec("copy-construct")
        elif vb != EMPTY:
            self._rec("destroy")
        self.slots[b] = va

    def moveConstruct(self, a, b):
        assert a != b
        v = self._held(a)
        self._drop(b)
        if v != EMPTY:
            self._rec("move-construct")
            self.slots[a] = -1
        self.slots[b] = v

    def moveAssign(self, a, b):
        va, vb = self._held(a), self._held(b)
        if a == b:
            return
        if va != EMPTY and vb != EMPTY:
            self._rec("move-assign")
        elif va != EMPTY:
            self._rec("move-construct")
        elif vb != EMPTY:
            self._rec("destroy")
        self.slots[b] = va
        if va != EMPTY:
            self.slots[a] = -1

    def destroy(self, s):
        self._held(s)
        self._drop(s)

    def destroyAll(self):
        for s in sorted(self.slots):
            self._drop(s)

    def alive(self):
        return sum(1 for v in self.slots.values() if v != EMPTY)

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
    vals = iter(rng.sample(range(10, 1000), 900))
    for s in range(SLOTS):
        o = rng.choice([op("makeEmpty", s), op("makeCopy", s, next(vals)), op("makeMove", s, next(vals))])
        getattr(m, o[0])(*o[1])
        ops.append(o)
    while len(ops) < n:
        held = sorted(m.slots)
        c = rng.choice(["makeEmpty", "makeCopy", "makeMove", "emplace", "emplace", "emplaceThrows", "reset",
                        "hasValue", "value", "value", "valueOr", "copyConstruct", "copyAssign", "copyAssign",
                        "moveConstruct", "moveAssign", "moveAssign", "destroy", "alive", "ops", "ops"])
        if c in ("makeEmpty",):
            o = op(c, rng.randrange(SLOTS))
        elif c in ("makeCopy", "makeMove"):
            o = op(c, rng.randrange(SLOTS), next(vals))
        elif c in ("emplace", "emplaceThrows", "valueOr"):
            if not held:
                continue
            o = op(c, rng.choice(held), next(vals))
        elif c in ("reset", "hasValue", "value", "destroy"):
            if not held:
                continue
            o = op(c, rng.choice(held))
        elif c in ("copyConstruct", "moveConstruct"):
            if not held:
                continue
            a = rng.choice(held)
            o = op(c, a, rng.choice([s for s in range(SLOTS) if s != a]))
        elif c in ("copyAssign", "moveAssign"):
            if not held:
                continue
            o = op(c, rng.choice(held), rng.choice(held))
        else:
            o = op(c)
        getattr(m, o[0])(*o[1])
        ops.append(o)
    return ops + [op("ops")]


V = lambda s: op("value", s)
H = lambda s: op("hasValue", s)
OPS = op("ops")

tests = [
    case("s1-basics", False, [
        op("makeEmpty", 0), H(0), V(0), op("alive"), OPS, op("emplace", 0, 7), H(0), V(0), op("alive"), OPS,
        op("emplace", 0, 8), V(0), OPS, op("valueOr", 0, 99), op("reset", 0), H(0), op("valueOr", 0, 99), OPS,
        op("alive"),
    ], "An empty Optional holds no Tracked. emplace constructs one in place; emplacing again destroys "
       "the old value first. value_or copies the value, or builds the fallback from the int only when "
       "empty. value() on an empty Optional throws std::bad_optional_access (-4)."),
    case("s2-assignment", False, [
        op("makeCopy", 0, 1), op("makeCopy", 1, 2), OPS, op("copyAssign", 0, 1), V(1), OPS,
        op("makeEmpty", 2), op("copyAssign", 0, 2), V(2), OPS, op("makeEmpty", 3), op("copyAssign", 3, 0),
        H(0), OPS, op("copyAssign", 3, 2), H(2), OPS, op("alive"),
    ], "Copy assignment: both engaged -> copy-assign the value; only the source engaged -> copy-construct; "
       "only the target engaged -> destroy its value; both empty -> nothing."),
    case("s3-move", False, [
        op("makeMove", 0, 5), OPS, op("moveConstruct", 0, 1), OPS, H(0), V(0), V(1), op("makeCopy", 2, 6),
        op("moveAssign", 1, 2), OPS, V(1), V(2), op("alive"),
    ], "Moving from an engaged Optional moves its value and leaves the source engaged, holding a "
       "moved-from value (-1), as std::optional does."),

    case("h-empty-holds-nothing", True, [
        op("makeEmpty", 0), op("makeEmpty", 1), op("alive"), OPS, op("copyConstruct", 0, 2), op("moveConstruct", 1, 3),
        H(2), H(3), op("copyAssign", 0, 1), op("moveAssign", 2, 3), op("reset", 0), op("reset", 0), OPS,
        op("destroy", 0), op("destroy", 1), OPS, op("errors"),
    ], "An empty Optional never constructs, assigns or destroys a value, whatever is done to it."),
    case("h-make", True, [
        op("makeCopy", 0, 3), OPS, V(0), op("makeMove", 1, 4), OPS, V(1), op("makeCopy", 0, 5), OPS, V(0),
        op("alive"),
    ], "Optional(const T&) copy-constructs once, Optional(T&&) move-constructs once."),
    case("h-destructor", True, [
        op("makeCopy", 0, 1), op("makeEmpty", 1), op("emplace", 1, 2), op("makeCopy", 2, 3), op("reset", 2),
        OPS, op("destroy", 0), OPS, op("alive"), op("destroy", 1), op("destroy", 2), OPS, op("alive"), op("errors"),
    ], "The destructor destroys an engaged value exactly once and an empty Optional destroys nothing.",
        check_end=False),
    case("h-reset", True, [
        op("makeCopy", 0, 1), op("reset", 0), H(0), V(0), op("alive"), op("reset", 0), OPS, op("emplace", 0, 2),
        op("reset", 0), op("emplace", 0, 3), V(0), OPS, op("errors"),
    ], "reset destroys the value once; resetting an empty Optional does nothing."),
    case("h-emplace", True, [
        op("makeEmpty", 0), op("emplace", 0, 10), op("emplace", 0, 11), op("emplace", 0, 12), OPS, V(0),
        op("alive"), op("makeCopy", 1, 13), op("emplace", 1, 14), OPS, V(1), op("errors"),
    ], "emplace on an engaged Optional destroys the old value and constructs the new one in place "
       "from the forwarded arguments: no copy, no move, no assignment."),
    case("h-emplace-throws", True, [
        op("makeCopy", 0, 1), OPS, op("emplaceThrows", 0, 2), H(0), V(0), op("alive"), OPS,
        op("emplaceThrows", 0, 3), H(0), OPS, op("emplace", 0, 4), V(0), op("errors"),
    ], "If T's constructor throws in emplace, the exception propagates, the old value has already been "
       "destroyed and the Optional is empty."),
    case("h-value-access", True, [
        op("makeMove", 0, 21), V(0), op("makeEmpty", 1), V(1), op("emplace", 1, 22), V(1), op("reset", 1), V(1),
        op("errors"),
    ], "value(), operator* and operator-> all reach the same object, stored inside the Optional."),
    case("h-value-or", True, [
        op("makeCopy", 0, 30), OPS, op("valueOr", 0, 31), OPS, V(0), op("alive"), op("makeEmpty", 1),
        op("valueOr", 1, 32), OPS, op("alive"), op("moveConstruct", 0, 2), op("valueOr", 0, 33), OPS,
    ], "value_or copies the value if engaged (a moved-from value is still a value: -1); otherwise it "
       "constructs T from the fallback, once."),
    case("h-copy-construct", True, [
        op("makeCopy", 0, 40), OPS, op("copyConstruct", 0, 1), OPS, V(0), V(1), op("emplace", 1, 41), V(0), V(1),
        op("makeEmpty", 2), op("copyConstruct", 2, 3), H(3), OPS, op("alive"),
    ], "Copy construction copy-constructs the value (if any) into the new Optional's own storage."),
    case("h-copy-assign-both", True, [
        op("makeCopy", 0, 50), op("makeCopy", 1, 51), OPS, op("copyAssign", 0, 1), OPS, V(0), V(1), op("alive"),
        op("errors"),
    ], "Both engaged: assign the value (T's copy assignment), do not destroy and reconstruct."),
    case("h-copy-assign-into-empty", True, [
        op("makeCopy", 0, 52), op("makeEmpty", 1), OPS, op("copyAssign", 0, 1), OPS, H(1), V(1), op("alive"),
        op("errors"),
    ], "Only the source engaged: construct the value (the target's storage holds no object to assign to)."),
    case("h-copy-assign-from-empty", True, [
        op("makeEmpty", 0), op("makeCopy", 1, 53), OPS, op("copyAssign", 0, 1), OPS, H(1), V(1), op("alive"),
        op("copyAssign", 0, 1), OPS, op("errors"),
    ], "Only the target engaged: destroy its value; the target becomes empty."),
    case("h-move-assign-cases", True, [
        op("makeCopy", 0, 60), op("makeCopy", 1, 61), OPS, op("moveAssign", 0, 1), OPS, V(0), V(1),
        op("makeEmpty", 2), op("moveAssign", 1, 2), OPS, V(1), V(2), op("makeEmpty", 3), op("moveAssign", 3, 2),
        OPS, H(2), H(3), op("moveAssign", 3, 2), OPS, op("alive"), op("errors"),
    ], "Move assignment follows the same four cases with move-assign / move-construct; a moved-from "
       "source stays engaged."),
    case("h-moved-from-stays-engaged", True, [
        op("makeCopy", 0, 70), op("moveConstruct", 0, 1), H(0), V(0), op("alive"), OPS, op("moveConstruct", 0, 2),
        V(2), OPS, op("makeEmpty", 3), op("moveAssign", 0, 3), H(3), V(3),
        H(0), op("errors"),
    ], "A moved-from Optional is not reset: it still holds a (moved-from) value that its destructor destroys."),
    case("h-self-assign", True, [
        op("makeCopy", 0, 80), op("copyAssign", 0, 0), H(0), V(0), op("moveAssign", 0, 0), H(0), V(0),
        op("makeEmpty", 1), op("copyAssign", 1, 1), op("moveAssign", 1, 1), H(1), op("alive"), op("errors"),
    ], "o = o and o = std::move(o) leave o as it was."),
    case("h-forwarding", True, [
        op("makeEmpty", 0), op("emplace", 0, 90), op("errors"),
    ], "emplace perfectly forwards its arguments (an rvalue stays an rvalue)."),
]
rng = random.Random(77)
for k, n in enumerate([30, 50, 80, 120, 200, 300]):
    tests.append(case(f"h-rand-{k}", True, random_ops(rng, n)))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
