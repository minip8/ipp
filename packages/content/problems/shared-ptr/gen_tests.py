"""Regenerates tests.json deterministically.

There is no Python reference solution for this C++-only problem: expected values come from a
small model of std::shared_ptr ownership as seen through the harness (harness.cpp). Each slot is
absent (no SharedPtr), None (a null SharedPtr) or the value of the object it shares; `count`
holds each live object's number of owners, and one control block exists per live object.
"""
import json, random, pathlib

here = pathlib.Path(__file__).parent
SLOTS = 8


class Model:
    def __init__(self):
        self.slots = {}   # slot -> None | value
        self.count = {}   # live value -> owners
        self.dead = []
        self.used = set()

    def _new(self, v):
        assert v not in self.used, "values must be unique per test"
        self.used.add(v)
        self.count[v] = 1

    def _drop(self, v):
        if v is None:
            return
        self.count[v] -= 1
        if self.count[v] == 0:
            del self.count[v]
            self.dead.append(v)

    def _add(self, v):
        if v is not None:
            self.count[v] += 1

    def _held(self, s):
        assert s in self.slots, f"slot {s} holds no SharedPtr"
        return self.slots[s]

    def _replace_slot(self, s, v):
        """optional::emplace: destroy the old SharedPtr, then construct the new one."""
        if s in self.slots:
            self._drop(self.slots[s])
        self.slots[s] = v

    def make(self, s, v):
        old = self.slots.get(s)
        had = s in self.slots
        self._new(v)
        if had:
            self._drop(old)
        self.slots[s] = v

    def makeNull(self, s):
        self._replace_slot(s, None)

    def copyConstruct(self, a, b):
        assert a != b
        v = self._held(a)
        self._replace_slot(b, None)
        self._add(v)
        self.slots[b] = v

    def copyAssign(self, a, b):
        va, vb = self._held(a), self._held(b)
        if va == vb:
            return
        self._add(va)
        self.slots[b] = va
        self._drop(vb)

    def moveConstruct(self, a, b):
        assert a != b
        v = self._held(a)
        self._replace_slot(b, None)
        self.slots[b] = v
        self.slots[a] = None

    def moveAssign(self, a, b):
        va, vb = self._held(a), self._held(b)
        if a == b:
            return
        self.slots[b] = va
        self.slots[a] = None
        self._drop(vb)

    def reset(self, s, v):
        old = self._held(s)
        self._new(v)
        self.slots[s] = v
        self._drop(old)

    def resetNull(self, s):
        old = self._held(s)
        self.slots[s] = None
        self._drop(old)

    def swap(self, a, b):
        va, vb = self._held(a), self._held(b)
        self.slots[a], self.slots[b] = vb, va

    def destroy(self, s):
        self._drop(self._held(s))
        del self.slots[s]

    def destroyAll(self):
        for s in sorted(self.slots):
            self._drop(self.slots[s])
        self.slots.clear()

    def constructFailingAlloc(self, v):
        assert v not in self.used
        self.used.add(v)
        self.dead.append(v)   # the constructor deletes p before rethrowing
        return True

    def value(self, s):
        v = self._held(s)
        return -1 if v is None else v

    def isNull(self, s):
        return self._held(s) is None

    def useCount(self, s):
        v = self._held(s)
        return 0 if v is None else self.count[v]

    def alive(self):
        return len(self.count)

    def destroyed(self):
        return list(self.dead)

    def heapBlocks(self):
        return len(self.count)

    def errors(self):
        return []


def case(id, hidden, ops, explanation=None, check_end=True):
    ops = list(ops)
    if check_end:
        ops += [("destroyAll", []), ("alive", []), ("heapBlocks", []), ("errors", [])]
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
        choices = ["make", "makeNull"]
        if held:
            choices += ["copyConstruct", "copyConstruct", "copyAssign", "copyAssign", "moveConstruct",
                        "moveAssign", "reset", "resetNull", "swap", "destroy", "value", "useCount",
                        "useCount", "isNull", "alive", "heapBlocks"]
        c = rng.choice(choices)
        if c == "make":
            o = op("make", rng.randrange(SLOTS), fresh())
        elif c == "makeNull":
            o = op("makeNull", rng.randrange(SLOTS))
        elif c in ("copyConstruct", "moveConstruct"):
            a = rng.choice(held)
            o = op(c, a, rng.choice([s for s in range(SLOTS) if s != a]))
        elif c in ("copyAssign", "moveAssign", "swap"):
            o = op(c, rng.choice(held), rng.choice(held))
        elif c == "reset":
            o = op("reset", rng.choice(held), fresh())
        elif c in ("alive", "heapBlocks"):
            o = op(c)
        else:
            o = op(c, rng.choice(held))
        getattr(m, o[0])(*o[1])
        ops.append(o)
        if rng.random() < 0.08:
            ops.append(op("destroyed"))
    return ops


tests = [
    case("s1-copies-share", False, [
        op("make", 0, 7), op("copyConstruct", 0, 1), op("copyConstruct", 1, 2), op("useCount", 0),
        op("heapBlocks"), op("destroy", 0), op("useCount", 2), op("value", 1), op("destroy", 1),
        op("destroyed"), op("destroy", 2), op("destroyed"),
    ], "Three SharedPtrs share one object and one control block. The object is deleted only when "
       "the last of them goes away."),
    case("s2-assign", False, [
        op("make", 0, 1), op("make", 1, 2), op("copyAssign", 0, 1), op("destroyed"), op("useCount", 0),
        op("copyAssign", 1, 1), op("useCount", 1), op("value", 1), op("moveAssign", 0, 0),
        op("makeNull", 3), op("moveAssign", 1, 3), op("isNull", 1), op("useCount", 3), op("heapBlocks"),
    ], "Copy-assigning 1 over 2 deletes 2 (its last owner let go) and shares 1. Self-assignment "
       "changes nothing. Moving transfers ownership without changing the count."),
    case("s3-reset-null", False, [
        op("makeNull", 0), op("useCount", 0), op("isNull", 0), op("heapBlocks"), op("copyConstruct", 0, 1),
        op("useCount", 1), op("make", 2, 5), op("copyConstruct", 2, 3), op("reset", 2, 6),
        op("useCount", 2), op("useCount", 3), op("resetNull", 3), op("destroyed"), op("heapBlocks"),
    ], "A null SharedPtr has use_count 0 and no control block. reset gives up this pointer's share "
       "of its old object (deleting it if it was the last owner) and starts a new group."),

    case("h-null-everything", True, [
        op("makeNull", 0), op("makeNull", 1), op("copyAssign", 0, 1), op("moveAssign", 1, 0),
        op("moveConstruct", 0, 2), op("swap", 1, 2), op("resetNull", 1), op("useCount", 2),
        op("value", 0), op("heapBlocks"), op("alive"),
    ]),
    case("h-single-owner", True, [
        op("make", 0, 10), op("useCount", 0), op("heapBlocks"), op("alive"), op("destroy", 0),
        op("alive"), op("heapBlocks"), op("destroyed"),
    ], "The destructor of the last owner deletes the object and frees the control block."),
    case("h-copy-no-alloc", True, [
        op("make", 0, 11), op("copyConstruct", 0, 1), op("copyConstruct", 0, 2), op("copyConstruct", 2, 3),
        op("heapBlocks"), op("useCount", 3), op("copyAssign", 3, 0), op("useCount", 0),
    ], "Copies share the existing control block: still exactly one heap block."),
    case("h-self-copy-assign", True, [
        op("make", 0, 20), op("copyAssign", 0, 0), op("value", 0), op("useCount", 0), op("alive"),
        op("destroyed"), op("copyConstruct", 0, 1), op("copyAssign", 1, 1), op("useCount", 1),
    ], "Self-assignment must not release the last reference before taking it again."),
    case("h-assign-same-group", True, [
        op("make", 0, 21), op("copyConstruct", 0, 1), op("copyAssign", 0, 1), op("useCount", 0),
        op("copyAssign", 1, 0), op("useCount", 1), op("moveAssign", 0, 1), op("useCount", 1),
        op("isNull", 0), op("alive"),
    ], "Assigning between two pointers that already share the object leaves the count unchanged; "
       "moving one onto the other drops one share."),
    case("h-copy-assign-releases-old", True, [
        op("make", 0, 30), op("make", 1, 31), op("copyConstruct", 1, 2), op("copyAssign", 0, 1),
        op("destroyed"), op("useCount", 2), op("copyAssign", 0, 2), op("destroyed"), op("useCount", 0),
        op("heapBlocks"),
    ]),
    case("h-move-construct", True, [
        op("make", 0, 40), op("moveConstruct", 0, 1), op("isNull", 0), op("useCount", 0),
        op("useCount", 1), op("value", 1), op("moveConstruct", 1, 2), op("heapBlocks"), op("alive"),
    ], "A move steals the share: the count stays 1 and the source becomes null."),
    case("h-move-assign-releases-old", True, [
        op("make", 0, 50), op("make", 1, 51), op("moveAssign", 0, 1), op("destroyed"), op("useCount", 1),
        op("isNull", 0), op("heapBlocks"), op("copyConstruct", 1, 2), op("makeNull", 3),
        op("moveAssign", 3, 2), op("useCount", 1), op("isNull", 2),
    ]),
    case("h-self-move-assign", True, [
        op("make", 0, 60), op("moveAssign", 0, 0), op("value", 0), op("useCount", 0),
        op("copyConstruct", 0, 1), op("moveAssign", 1, 1), op("useCount", 0), op("destroyed"),
    ]),
    case("h-reset-shared", True, [
        op("make", 0, 70), op("copyConstruct", 0, 1), op("reset", 0, 71), op("destroyed"),
        op("useCount", 1), op("useCount", 0), op("heapBlocks"), op("resetNull", 1), op("destroyed"),
        op("heapBlocks"), op("reset", 1, 72), op("value", 1),
    ], "Resetting one of two owners does not delete the shared object; resetting the last one does."),
    case("h-swap", True, [
        op("make", 0, 80), op("make", 1, 81), op("copyConstruct", 1, 2), op("swap", 0, 1),
        op("value", 0), op("useCount", 0), op("useCount", 1), op("swap", 2, 2), op("value", 2),
        op("makeNull", 3), op("swap", 3, 1), op("isNull", 1), op("value", 3), op("alive"),
    ]),
    case("h-make-over-existing", True, [
        op("make", 0, 90), op("copyConstruct", 0, 1), op("make", 0, 91), op("destroyed"),
        op("useCount", 1), op("make", 1, 92), op("destroyed"), op("heapBlocks"),
    ], "Replacing a SharedPtr in a slot runs its destructor, dropping one share."),
    case("h-ctor-alloc-fails", True, [
        op("make", 0, 100), op("constructFailingAlloc", 101), op("alive"), op("destroyed"),
        op("heapBlocks"), op("useCount", 0), op("constructFailingAlloc", 102), op("destroyed"),
    ], "When the control block cannot be allocated, the constructor deletes p and rethrows."),
    case("h-long-chain", True,
         [op("make", 0, 110)] + [op("copyAssign", 0, 0)] * 3 +
         [x for k in range(1, 8) for x in (op("copyConstruct", k - 1, k), op("useCount", 0))] +
         [x for k in range(7, 0, -1) for x in (op("destroy", k), op("useCount", 0))] +
         [op("heapBlocks"), op("destroyed")]),
]
rng = random.Random(2011)
for k, n in enumerate([30, 50, 80, 120, 160, 220]):
    tests.append(case(f"h-rand-{k}", True, random_ops(rng, n)))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
