"""Regenerates tests.json deterministically from the Python reference solution.

Every sequence is replayed against a brute-force model (a plain Python list plus a capacity
counter following the statement's rules) and both must agree.
"""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


class Model:
    def __init__(self): self.a, self.cap = [], 0
    def _room(self):
        if len(self.a) == self.cap: self.cap = 1 if self.cap == 0 else 2 * self.cap
    def pushBack(self, v): self._room(); self.a.append(v)
    def popBack(self): return self.a.pop() if self.a else -1
    def get(self, i): return self.a[i] if 0 <= i < len(self.a) else -1
    def set(self, i, v):
        if not 0 <= i < len(self.a): return False
        self.a[i] = v; return True
    def insert(self, i, v):
        if not 0 <= i <= len(self.a): return False
        self._room(); self.a.insert(i, v); return True
    def erase(self, i): return self.a.pop(i) if 0 <= i < len(self.a) else -1
    def size(self): return len(self.a)
    def capacity(self): return self.cap
    def reserve(self, n): self.cap = max(self.cap, n)
    def resize(self, n, v):
        if n > self.cap: self.cap = max(n, 2 * self.cap)
        self.a = self.a[:n] + [v] * (n - len(self.a))
    def shrinkToFit(self): self.cap = len(self.a)
    def toArray(self): return list(self.a)


def run(cls, ops):
    obj = cls()
    return [getattr(obj, m)(*a) for m, a in ops]


def case(id, hidden, ops, explanation=None):
    expected = run(mod.DynamicArray, ops)
    assert expected == run(Model, ops), id
    t = {"id": id, "hidden": hidden, "ctorArgs": [],
         "calls": [{"method": m, "args": a} for m, a in ops], "expected": expected}
    if explanation: t["explanation"] = explanation
    return t


PB = lambda v: ("pushBack", [v])
PO = ("popBack", [])
G = lambda i: ("get", [i])
S = lambda i, v: ("set", [i, v])
I = lambda i, v: ("insert", [i, v])
E = lambda i: ("erase", [i])
SZ, CAP, SH, A = ("size", []), ("capacity", []), ("shrinkToFit", []), ("toArray", [])
RS = lambda n: ("reserve", [n])
RZ = lambda n, v: ("resize", [n, v])


def random_ops(rng, n, maxv=10**9, size_hint=20):
    """Mixed operations on a small array; sizes stay around size_hint."""
    ops, size = [], 0
    for _ in range(n):
        r = rng.random()
        v = rng.randint(0, maxv)
        if r < 0.25 + (0.15 if size < size_hint else 0):
            ops.append(PB(v)); size += 1
        elif r < 0.35:
            ops.append(PO); size = max(0, size - 1)
        elif r < 0.45:
            i = rng.randint(-1, size + 1)
            ops.append(I(i, v)); size += 0 <= i <= size
        elif r < 0.55:
            i = rng.randint(-1, size)
            ops.append(E(i)); size -= 0 <= i < size
        elif r < 0.63:
            ops.append(G(rng.randint(-1, size)))
        elif r < 0.68:
            ops.append(S(rng.randint(-1, size), v))
        elif r < 0.72:
            ops.append(RS(rng.randint(0, 2 * size_hint)))
        elif r < 0.75:
            size = rng.randint(0, 2 * size_hint); ops.append(RZ(size, v))
        elif r < 0.77:
            ops.append(SH)
        elif r < 0.85:
            ops.append(CAP)
        elif r < 0.9:
            ops.append(SZ)
        else:
            ops.append(A)
    return ops


rng = random.Random(1979)

# Self-check on many small random sequences first.
for _ in range(400):
    ops = random_ops(rng, 80, maxv=50, size_hint=rng.randint(1, 12))
    assert run(mod.DynamicArray, ops) == run(Model, ops)

tests = [
    case("s1", False, [CAP, PB(5), PB(6), PB(7), CAP, I(0, 4), I(9, 1), E(1), PO, CAP, SH, CAP, G(2), A],
         "Capacity goes 0 -> 1 -> 2 -> 4 and does not shrink on removal; shrinkToFit sets it to the size."),
    case("s2", False, [SZ, CAP, PO, G(0), S(0, 1), E(0), I(1, 1), I(-1, 1), A, SH, CAP, I(0, 8), CAP, G(0)],
         "Every out-of-range call on an empty array fails without changing anything; insert(0, v) is valid."),
    case("s3", False, [RS(10), CAP, RS(3), CAP, RZ(12, 9), SZ, CAP, RZ(2, 0), CAP, A, SH, CAP],
         "reserve never shrinks; resize past the capacity takes max(n, 2 * capacity) = 20."),
    case("h-capacity-each-push", True, [x for v in range(1, 18) for x in (PB(v), CAP, SZ)],
         "Growth happens only when a push finds size == capacity: 1, 2, 4, 4, 8, ..., 16, 32."),
    case("h-insert-when-full", True,
         [PB(1), PB(2), I(0, 0), CAP, I(3, 3), CAP, I(2, 9), I(5, 8), CAP, A, I(8, 7), CAP, A],
         "insert at the front, middle and end when size == capacity must grow first, then shift."),
    case("h-insert-bounds", True,
         [I(0, 1), I(1, 2), I(3, 9), I(-1, 9), I(2, 3), I(0, 0), I(4, 4), I(6, 9), A, SZ]),
    case("h-erase-ends", True,
         [PB(v) for v in range(10, 16)] + [E(0), E(4), E(5), E(-1), A, E(2), A, E(0), E(0), E(0), E(0), SZ, CAP, A],
         "Erasing the first and the last element, and indices one past the end."),
    case("h-pop-to-empty", True,
         [PB(1), PB(2), PB(3), PO, PO, PO, PO, SZ, CAP, G(0), PB(4), CAP, A],
         "Popping never shrinks the capacity, and popping an empty array returns -1."),
    case("h-shrink-then-grow", True,
         [PB(1), PB(2), PB(3), SH, CAP, PB(4), CAP, PB(5), PB(6), PB(7), CAP, A],
         "After shrinkToFit the capacity is 3, so the next growth doubles it to 6 (not to a power of two)."),
    case("h-shrink-empty", True,
         [PB(1), PB(2), PO, PO, CAP, SH, CAP, PB(3), CAP, SH, CAP, A],
         "shrinkToFit on an empty array gives capacity 0; the next push grows it to 1."),
    case("h-reserve-exact", True,
         [RS(0), CAP, RS(5), CAP, SZ] + [PB(v) for v in range(6)] + [CAP, RS(11), CAP, RS(4), CAP, A],
         "reserve(5) sets the capacity to exactly 5, so the sixth push doubles it to 10."),
    case("h-resize-refill", True,
         [PB(v) for v in (1, 2, 3, 4, 5)] + [RZ(2, 0), A, CAP, RZ(5, 7), A, CAP, RZ(0, 0), SZ, A, RZ(3, 6), A],
         "Growing again within the capacity must write the fill value, not reveal the old elements."),
    case("h-resize-capacity", True,
         [PB(1), PB(2), PB(3), RZ(5, 1), CAP, RZ(20, 2), CAP, RZ(20, 3), CAP, RZ(41, 4), CAP, SZ, G(40), G(41)],
         "resize to 5 with capacity 4 gives max(5, 8) = 8; to 20 with capacity 8 gives 20; to 41 gives 41."),
    case("h-set-get-bounds", True,
         [PB(1), PB(2), S(0, 10), S(1, 20), S(2, 30), S(-1, 30), G(-1), G(0), G(1), G(2), A]),
    case("h-zero-values", True, [PB(0), PB(0), I(1, 0), G(1), E(2), PO, PO, PO, A]),
]
for k, (n, hint) in enumerate([(60, 3), (120, 8), (250, 16), (400, 30), (600, 5)]):
    tests.append(case(f"h-rand-{k}", True, random_ops(rng, n, size_hint=hint)))

# Many pushes and pops around the capacity boundaries, checking capacity as they go.
ops = []
for v in range(2100):
    ops.append(PB(v % 1000))
    if v & (v + 1) == 0 or v % 97 == 0: ops += [CAP, G(v)]
for _ in range(300):
    ops += [PO, PB(1)]  # thrash across a boundary: capacity must stay put
ops += [CAP, SZ, G(0), G(2099)]
tests.append(case("h-large-push", True, ops, "2100 pushes; pops and pushes at a power-of-two size never resize."))

# A million elements, then pushes: each push must be amortised O(1), not a copy of the array.
big, ops = 10**6, [RZ(10**6, 3), CAP]
size = big
for j in range(2500):
    r = rng.random()
    if r < 0.6:
        ops.append(PB(rng.randint(0, 999))); size += 1
    elif r < 0.7:
        ops.append(G(rng.randint(0, size - 1)))
    elif r < 0.78:
        ops.append(PO); size -= 1
    elif r < 0.86:
        ops.append(E(size - 1 - rng.randint(0, 5))); size -= 1
    elif r < 0.94:
        ops.append(I(size - rng.randint(0, 5), rng.randint(0, 999))); size += 1
    else:
        ops.append(S(rng.randint(0, size - 1), rng.randint(0, 999)))
    if j % 250 == 0: ops += [CAP, SZ]
ops += [CAP, SZ, RZ(5, 0), A, CAP, SH, CAP, PB(1), CAP]
tests.append(case("h-large-resize", True, ops,
                  "resize to 10^6, then 2500 operations near the end: growth happens once, to 2 * 10^6."))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
