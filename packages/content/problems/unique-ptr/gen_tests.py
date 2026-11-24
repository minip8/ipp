"""Regenerates tests.json deterministically.

There is no Python reference solution for this C++-only problem: expected values come from a
small model of std::unique_ptr ownership as seen through the harness (harness.cpp). Each slot is
absent (no UniquePtr), None (a null UniquePtr) or the value of the one object it owns.
"""
import json, random, pathlib

here = pathlib.Path(__file__).parent
SLOTS = 8


class Model:
    def __init__(self):
        self.slots = {}          # slot -> None | value
        self.alive_set = set()
        self.dead = []

    def _kill(self, v):
        if v is not None:
            self.alive_set.discard(v)
            self.dead.append(v)

    def _new(self, v):
        assert v not in self.alive_set and v not in self.dead, "values must be unique per test"
        self.alive_set.add(v)

    def _held(self, s):
        assert s in self.slots, f"slot {s} holds no UniquePtr"
        return self.slots[s]

    # Each op returns the harness method's result (None for void).
    def make(self, s, v):
        self._new(v)                      # `new Tracked(v)` runs before emplace destroys the old one
        if s in self.slots:
            self._kill(self.slots[s])
        self.slots[s] = v

    def makeNull(self, s):
        if s in self.slots:
            self._kill(self.slots[s])
        self.slots[s] = None

    def makeUnique(self, s, v, rvalue):
        self.make(s, v)
        return rvalue

    def moveConstruct(self, a, b):
        assert a != b
        v = self._held(a)
        if b in self.slots:
            self._kill(self.slots[b])
        self.slots[b] = v
        self.slots[a] = None

    def moveAssign(self, a, b):
        va, vb = self._held(a), self._held(b)
        if a == b:
            return
        self.slots[b] = va
        self.slots[a] = None
        self._kill(vb)

    def release(self, s):
        v = self._held(s)
        self.slots[s] = None
        if v is None:
            return -1
        self._kill(v)                     # the harness deletes the released object itself
        return v

    def reset(self, s, v):
        old = self._held(s)
        self._new(v)
        self.slots[s] = v
        self._kill(old)

    def resetNull(self, s):
        old = self._held(s)
        self.slots[s] = None
        self._kill(old)

    def swap(self, a, b):
        va, vb = self._held(a), self._held(b)
        self.slots[a], self.slots[b] = vb, va

    def destroy(self, s):
        self._kill(self._held(s))
        del self.slots[s]

    def destroyAll(self):
        for s in sorted(self.slots):
            self._kill(self.slots[s])
        self.slots.clear()

    def value(self, s):
        v = self._held(s)
        return -1 if v is None else v

    def isNull(self, s):
        return self._held(s) is None

    def alive(self):
        return len(self.alive_set)

    def destroyed(self):
        return list(self.dead)

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
    ops, nxt = [], [1]

    def fresh():
        nxt[0] += rng.randint(1, 5)
        return nxt[0]

    for _ in range(n):
        held = sorted(m.slots)
        choices = ["make", "makeNull", "makeUnique"]
        if held:
            choices += ["moveAssign", "release", "reset", "resetNull", "swap", "destroy", "value", "isNull",
                        "value", "alive", "moveConstruct"]
        c = rng.choice(choices)
        if c == "make":
            o = op("make", rng.randrange(SLOTS), fresh())
        elif c == "makeNull":
            o = op("makeNull", rng.randrange(SLOTS))
        elif c == "makeUnique":
            o = op("makeUnique", rng.randrange(SLOTS), fresh(), rng.random() < 0.5)
        elif c == "moveAssign":
            o = op("moveAssign", rng.choice(held), rng.choice(held))
        elif c == "moveConstruct":
            a = rng.choice(held)
            b = rng.choice([s for s in range(SLOTS) if s != a])
            o = op("moveConstruct", a, b)
        elif c in ("reset",):
            o = op("reset", rng.choice(held), fresh())
        elif c == "swap":
            o = op("swap", rng.choice(held), rng.choice(held))
        else:
            o = op(c, rng.choice(held)) if c != "alive" else op("alive")
        getattr(m, o[0])(*o[1])
        ops.append(o)
        if rng.random() < 0.1:
            ops.append(op("destroyed"))
    return ops


tests = [
    case("s1-move", False, [
        op("make", 0, 7), op("moveConstruct", 0, 1), op("isNull", 0), op("value", 1),
        op("make", 2, 8), op("moveAssign", 1, 2), op("destroyed"), op("value", 2), op("isNull", 1),
        op("alive"),
    ], "Moving leaves the source null. Move-assigning 7 into slot 2 deletes the 8 that slot 2 owned "
       "(destroyed() is [8]); destroyAll then deletes 7, and nothing is left alive."),
    case("s2-release-reset", False, [
        op("make", 0, 1), op("release", 0), op("isNull", 0), op("alive"),
        op("reset", 0, 2), op("reset", 0, 3), op("destroyed"), op("resetNull", 0), op("isNull", 0),
        op("destroyed"),
    ], "release() hands the object back without deleting it (the harness deletes it afterwards, so 1 "
       "appears in destroyed()). Each reset deletes the previously owned object."),
    case("s3-self-move-swap", False, [
        op("make", 0, 5), op("moveAssign", 0, 0), op("value", 0), op("alive"),
        op("makeNull", 1), op("swap", 0, 1), op("isNull", 0), op("value", 1), op("swap", 1, 1),
        op("value", 1), op("makeUnique", 2, 6, True), op("makeUnique", 3, 9, False), op("value", 3),
    ], "Self-move-assignment must leave the pointer owning its object. swap exchanges the pointers "
       "without deleting anything. makeUnique forwards its arguments: an rvalue stays an rvalue."),

    case("h-null-basics", True, [
        op("makeNull", 0), op("isNull", 0), op("value", 0), op("release", 0), op("resetNull", 0),
        op("isNull", 0), op("moveConstruct", 0, 1), op("isNull", 1), op("moveAssign", 1, 0),
        op("swap", 0, 1), op("destroy", 0), op("alive"), op("destroyed"),
    ]),
    case("h-destructor-deletes", True, [
        op("make", 0, 10), op("make", 1, 11), op("make", 2, 12), op("alive"), op("destroy", 1),
        op("destroyed"), op("alive"), op("destroy", 0), op("destroy", 2), op("destroyed"), op("alive"), op("errors"),
    ], check_end=False),
    case("h-move-construct-chain", True, [
        op("make", 0, 20), op("moveConstruct", 0, 1), op("moveConstruct", 1, 2), op("moveConstruct", 2, 3),
        op("isNull", 0), op("isNull", 1), op("isNull", 2), op("value", 3), op("alive"), op("destroyed"),
    ], "One object passed along a chain of moves is deleted exactly once, by the last owner."),
    case("h-move-assign-into-null", True, [
        op("make", 0, 30), op("makeNull", 1), op("moveAssign", 0, 1), op("isNull", 0), op("value", 1),
        op("destroyed"), op("alive"),
    ]),
    case("h-move-assign-from-null", True, [
        op("makeNull", 0), op("make", 1, 31), op("moveAssign", 0, 1), op("isNull", 1), op("destroyed"),
        op("alive"),
    ], "Assigning a null UniquePtr deletes what the target owned."),
    case("h-move-assign-deletes-old", True, [
        op("make", 0, 40), op("make", 1, 41), op("moveAssign", 0, 1), op("destroyed"), op("value", 1),
        op("isNull", 0), op("moveAssign", 1, 0), op("value", 0), op("isNull", 1), op("destroyed"),
    ]),
    case("h-self-move", True, [
        op("make", 3, 50), op("moveAssign", 3, 3), op("moveAssign", 3, 3), op("value", 3), op("isNull", 3),
        op("destroyed"), op("makeNull", 4), op("moveAssign", 4, 4), op("isNull", 4), op("alive"),
    ], "Self-move-assignment must not delete the owned object."),
    case("h-release-no-delete", True, [
        op("make", 0, 60), op("make", 1, 61), op("release", 1), op("alive"), op("isNull", 1),
        op("release", 1), op("value", 0), op("destroyed"),
    ], "release() must not delete; the harness deletes 61 itself after reading it."),
    case("h-reset-order", True, [
        op("make", 0, 70), op("reset", 0, 71), op("errors"), op("resetNull", 0), op("errors"),
        op("destroyed"), op("reset", 0, 72), op("value", 0),
    ], "While reset deletes the old object, the UniquePtr must already hold the new pointer."),
    case("h-reset-from-null", True, [
        op("makeNull", 0), op("reset", 0, 80), op("value", 0), op("alive"), op("destroyed"),
    ]),
    case("h-swap", True, [
        op("make", 0, 90), op("make", 1, 91), op("swap", 0, 1), op("value", 0), op("value", 1),
        op("swap", 0, 0), op("value", 0), op("alive"), op("destroyed"), op("destroy", 0), op("destroyed"),
    ]),
    case("h-make-over-existing", True, [
        op("make", 0, 100), op("make", 0, 101), op("destroyed"), op("makeNull", 0), op("destroyed"),
        op("makeUnique", 0, 102, True), op("makeUnique", 0, 103, False), op("destroyed"), op("value", 0),
    ], "Replacing the UniquePtr in a slot runs its destructor, which deletes the old object."),
    case("h-make-unique-forwarding", True, [
        op("makeUnique", 0, 1, True), op("makeUnique", 1, 2, False), op("makeUnique", 2, 3, True),
        op("value", 0), op("value", 1), op("value", 2), op("alive"),
    ], "makeUnique must perfectly forward: rvalues stay rvalues and lvalues stay lvalues."),
]
rng = random.Random(1997)
for k, n in enumerate([25, 40, 60, 80, 120, 200]):
    tests.append(case(f"h-rand-{k}", True, random_ops(rng, n)))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
