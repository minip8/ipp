"""Regenerates tests.json deterministically from the Python reference solution.

Every sequence is replayed against a brute-force model (a plain Python list) and both must agree.
Most tests read the list both ways (toArray and toArrayReversed) so a broken prev link shows up.
"""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


class Model:
    def __init__(self): self.a = []
    def pushFront(self, v): self.a.insert(0, v)
    def pushBack(self, v): self.a.append(v)
    def popFront(self): return self.a.pop(0) if self.a else -1
    def popBack(self): return self.a.pop() if self.a else -1
    def front(self): return self.a[0] if self.a else -1
    def back(self): return self.a[-1] if self.a else -1
    def get(self, i): return self.a[i] if 0 <= i < len(self.a) else -1
    def insert(self, i, v):
        if not 0 <= i <= len(self.a): return False
        self.a.insert(i, v); return True
    def erase(self, i): return self.a.pop(i) if 0 <= i < len(self.a) else -1
    def size(self): return len(self.a)
    def reverse(self): self.a.reverse()
    def toArray(self): return list(self.a)
    def toArrayReversed(self): return self.a[::-1]


def run(cls, ops):
    obj = cls()
    return [getattr(obj, m)(*a) for m, a in ops]


def case(id, hidden, ops, explanation=None):
    expected = run(mod.DoublyLinkedList, ops)
    assert expected == run(Model, ops), id
    t = {"id": id, "hidden": hidden, "ctorArgs": [],
         "calls": [{"method": m, "args": a} for m, a in ops], "expected": expected}
    if explanation: t["explanation"] = explanation
    return t


PF = lambda v: ("pushFront", [v])
PB = lambda v: ("pushBack", [v])
G = lambda i: ("get", [i])
I = lambda i, v: ("insert", [i, v])
E = lambda i: ("erase", [i])
OF, OB, F, B, SZ = ("popFront", []), ("popBack", []), ("front", []), ("back", []), ("size", [])
RV, A, AR = ("reverse", []), ("toArray", []), ("toArrayReversed", [])
BOTH = [A, AR]


def random_ops(rng, n, maxv=10**9, grow=0.5, read_every=0.08):
    ops, size = [], 0
    for _ in range(n):
        r = rng.random()
        v = rng.randint(0, maxv)
        if r < grow * 0.6:
            ops.append(rng.choice([PF, PB])(v)); size += 1
        elif r < grow:
            i = rng.randint(-1, size + 1)
            ops.append(I(i, v)); size += 0 <= i <= size
        elif r < grow + 0.12:
            ops.append(rng.choice([OF, OB])); size = max(0, size - 1)
        elif r < grow + 0.24:
            i = rng.randint(-1, size)
            ops.append(E(i)); size -= 0 <= i < size
        elif r < grow + 0.29:
            ops.append(RV)
        elif r < grow + 0.29 + read_every:
            ops.append(rng.choice(BOTH))
        else:
            ops.append(rng.choice([F, B, SZ, G(rng.randint(-1, size))]))
    return ops


rng = random.Random(707)

# Self-check on many small random sequences first.
for _ in range(400):
    ops = random_ops(rng, 80, 50, rng.choice([0.35, 0.45, 0.55]), 0.2)
    assert run(mod.DoublyLinkedList, ops) == run(Model, ops)

tests = [
    case("s1", False, [PB(1), PB(2), PB(3), PF(0), I(2, 9), I(6, 5), E(0), OB, RV, A, AR, G(2), B],
         "insert puts the value before the element at that position; reverse swaps the ends."),
    case("s2", False, [OF, OB, F, B, G(0), E(0), I(1, 5), I(-1, 5), RV, SZ] + BOTH + [I(0, 5), F, B] + BOTH,
         "Every read or removal on an empty list returns -1; insert(0, v) on an empty list is valid."),
    case("h-single-node", True, [PF(1), OB, SZ] + BOTH + [F, B, PB(2), OF] + BOTH + [PB(3), PF(4)] + BOTH,
         "Removing the only node from either end must reset both the front and the back."),
    case("h-insert-ends", True, [PB(5), I(0, 4), I(2, 6), I(0, 3), I(4, 7), I(6, 9), F, B] + BOTH,
         "insert at position 0 replaces the front; insert at position size replaces the back."),
    case("h-insert-middle", True, [PB(1), PB(5)] + [I(1, v) for v in (4, 3, 2)] + BOTH + [I(3, 9), I(2, 8)] + BOTH),
    case("h-erase-ends", True, [PB(v) for v in range(6)] + [E(0), F, E(4), B] + BOTH + [E(3), E(-1), E(1)] + BOTH + [E(0), E(0), E(0), SZ] + BOTH,
         "Erasing the first or the last node must update the front or back and the neighbour's link."),
    case("h-erase-to-empty", True, [PB(1), PB(2), PB(3), E(1), E(1), E(0), SZ, F, B] + BOTH + [PB(4), PF(5)] + BOTH),
    case("h-reverse-small", True, [RV, PB(1), RV, F, B] + BOTH + [PB(2), RV, F, B] + BOTH + [PB(3), RV] + BOTH,
         "Reversing lists of 0, 1, 2 and 3 nodes."),
    case("h-reverse-then-edit", True,
         [PB(v) for v in range(1, 6)] + [RV, PF(0), PB(9), OB, OF, OF] + BOTH + [I(1, 7), E(3), RV] + BOTH + [OB, OB, F, B] + BOTH,
         "After reverse, pushes and pops at both ends must use the swapped front and back."),
    case("h-reverse-twice", True, [PB(v) for v in range(7)] + [RV, RV] + BOTH + [E(6), E(0), RV] + BOTH),
    case("h-get-every-index", True, [PB(v * 10) for v in range(9)] + [G(i) for i in range(-1, 10)] + [RV] + [G(i) for i in range(9)],
         "Positions in the back half are reached through prev links when walking from the back."),
    case("h-bounds", True, [PB(1), PB(2), I(3, 9), I(-1, 9), E(2), E(-1), G(2), G(-1), I(2, 3), E(2), SZ] + BOTH),
    case("h-zero-values", True, [PB(0), PF(0), I(1, 0), E(1), OF, OB, OB, F] + BOTH),
]
for k, (n, grow) in enumerate([(60, 0.5), (150, 0.55), (300, 0.45), (500, 0.6), (600, 0.5)]):
    tests.append(case(f"h-rand-{k}", True, random_ops(rng, n, grow=grow, read_every=0.03)))

# Large: grow to about 1500 nodes with every kind of edit, then read everything both ways.
ops, size = [], 0
for j in range(2600):
    r = rng.random()
    v = rng.randint(0, 999)
    if r < 0.4:
        ops.append(rng.choice([PF, PB])(v)); size += 1
    elif r < 0.55:
        ops.append(I(rng.choice([0, size, rng.randint(0, size), rng.randint(0, min(size, 30)),
                                 size - rng.randint(0, min(size, 30))]), v)); size += 1
    elif r < 0.65:
        ops.append(rng.choice([OF, OB])); size = max(0, size - 1)
    elif r < 0.72 and size:
        ops.append(E(rng.choice([0, size - 1, rng.randint(0, size - 1)]))); size -= 1
    elif r < 0.73:
        ops.append(RV)
    else:
        ops.append(rng.choice([F, B, SZ, G(rng.randint(0, max(0, size - 1)))]))
ops += [SZ, F, B] + BOTH
tests.append(case("h-large", True, ops, "2600 mixed operations, then the whole list read both ways."))
# Large: a long run of pushes and pops at the ends with reverses in between.
ops = [PF(v % 1000) for v in range(1000)] + [RV] + [PB(v % 1000) for v in range(1000)] + [RV, G(10), G(1990), F, B]
ops += [x for _ in range(400) for x in (OF, OB)] + [RV, SZ, F, B, G(600)]
tests.append(case("h-large-ends", True, ops, "2000 pushes, reverses and 800 pops at both ends."))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
