"""Regenerates tests.json deterministically from the Python reference solution.

Every sequence is replayed against a brute-force model (a plain Python list) and both must agree.
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
    def size(self): return len(self.a)
    def resize(self, n, v): self.a = self.a[:n] + [v] * (n - len(self.a))
    def toArray(self): return list(self.a)


def run(cls, ops):
    obj = cls()
    return [getattr(obj, m)(*a) for m, a in ops]


def case(id, hidden, ops, explanation=None):
    expected = run(mod.RingDeque, ops)
    assert expected == run(Model, ops), id
    t = {"id": id, "hidden": hidden, "ctorArgs": [],
         "calls": [{"method": m, "args": a} for m, a in ops], "expected": expected}
    if explanation: t["explanation"] = explanation
    return t


PF = lambda v: ("pushFront", [v])
PB = lambda v: ("pushBack", [v])
G = lambda i: ("get", [i])
RZ = lambda n, v: ("resize", [n, v])
OF, OB, F, B, SZ, A = ("popFront", []), ("popBack", []), ("front", []), ("back", []), ("size", []), ("toArray", [])


def random_ops(rng, n, maxv=10**9, push_bias=0.45):
    ops, size = [], 0
    for _ in range(n):
        r = rng.random()
        v = rng.randint(0, maxv)
        if r < push_bias:
            ops.append(rng.choice([PF, PB])(v)); size += 1
        elif r < push_bias + 0.25:
            ops.append(rng.choice([OF, OB])); size = max(0, size - 1)
        elif r < push_bias + 0.35:
            ops.append(G(rng.randint(-1, size)))
        elif r < push_bias + 0.37:
            size = rng.randint(0, size + 10); ops.append(RZ(size, v))
        elif r < push_bias + 0.38 + (0.06 if size < 40 else 0):
            ops.append(A)
        else:
            ops.append(rng.choice([F, B, SZ]))
    return ops


rng = random.Random(641)

# Self-check on many small random sequences first.
for _ in range(400):
    ops = random_ops(rng, 80, 50, rng.choice([0.35, 0.45, 0.55]))
    assert run(mod.RingDeque, ops) == run(Model, ops)

# Grow through every size up to 70 while the buffer stays wrapped: whatever the initial capacity
# and growth factor, some growth happens with the front in the middle of the buffer.
grow_wrapped = []
v = 0
for step in range(70):
    grow_wrapped += [PF(v), PB(v + 1000)]; v += 1
    if step % 3 == 2: grow_wrapped.append(OF)
    if step % 5 == 4: grow_wrapped.append(OB)
    grow_wrapped += [A] if step % 2 else [F, B, G(step)]

tests = [
    case("s1", False, [PB(2), PB(3), PF(1), PF(0), G(1), OB, OF, PB(9), F, B, G(3), RZ(5, 4), A],
         "Pushes and pops at both ends; positions are counted from the front."),
    case("s2", False, [OF, OB, F, B, G(0), SZ, A, PF(5), B, F, OB, OF, SZ],
         "Every read or pop on an empty deque returns -1; one element is both the front and the back."),
    case("h-front-wraps-first", True, [PF(v) for v in range(1, 6)] + [F, B, G(0), G(4), A, OB, OB, A],
         "pushFront on an empty buffer must wrap the front index to the end of the buffer."),
    case("h-laps", True, [PB(1), PB(2), PB(3)] + [x for v in range(4, 64) for x in (PB(v), OF, G(0), G(2), B)] + [A],
         "A steady size of 3 moving around the buffer many times."),
    case("h-laps-backwards", True, [PF(1), PF(2), PF(3)] + [x for v in range(4, 64) for x in (PF(v), OB, G(0), G(2), F)] + [A]),
    case("h-grow-wrapped", True, grow_wrapped,
         "Growth while the elements wrap around the end of the buffer must keep them in order."),
    case("h-grow-front-only", True, [x for v in range(40) for x in ((PF(v), A) if v % 4 == 3 else (PF(v),))]),
    case("h-single-element", True, [PF(7), B, F, OB, F, B, PB(8), OF, SZ, PB(9), PF(10), OB, OB, OB, A]),
    case("h-drain-other-end", True,
         [PB(v) for v in range(5)] + [PF(v) for v in range(10, 15)] + [OB] * 6 + [A] + [OF] * 5 + [SZ, F, B]),
    case("h-get-bounds", True, [PB(4), PF(3), PB(5), G(-1), G(0), G(2), G(3), G(1000000), G(-1000000)]),
    case("h-resize", True,
         [PF(1), PF(2), PF(3), RZ(10, 9), A, F, B, RZ(2, 0), A, PB(4), A, RZ(0, 0), SZ, F, OF, RZ(3, 6), A, PF(5), A],
         "resize grows at the back (wrapping around the buffer when the front is near its end) and shrinks from the back."),
    case("h-resize-wrapped-grow", True,
         [PF(v) for v in range(1, 4)] + [RZ(5, 7), A, G(4), B, RZ(30, 8), G(2), G(5), G(29), A, OF, OB, A],
         "After pushFronts the elements sit at the end of the buffer, so the fill of resize must wrap to its start."),
    case("h-resize-sweep", True,
         [PB(0)] + [x for i in range(1, 70) for x in (PB(i), OF, RZ(4, 1000 + i), A, RZ(1, 0))],
         "The front moves one slot per step, so a short resize fill eventually crosses the end of the buffer."),
    case("h-zero-values", True, [PB(0), PF(0), F, B, OF, OB, OB, F, PB(0), G(0), A]),
]
for k, (n, bias) in enumerate([(60, 0.45), (150, 0.5), (300, 0.4), (500, 0.55), (600, 0.35)]):
    tests.append(case(f"h-rand-{k}", True, random_ops(rng, n, push_bias=bias)))

# Large: five million elements, then O(1) operations at both ends. Shifting on pushFront would copy
# the whole buffer on every call.
size, ops = 5 * 10**6, [RZ(5 * 10**6, 7)]
for j in range(2500):
    r = rng.random()
    if r < 0.5: ops.append(PF(rng.randint(0, 999))); size += 1
    elif r < 0.52: ops.append(PB(rng.randint(0, 999))); size += 1
    elif r < 0.9: ops.append(OF); size -= 1
    elif r < 0.92: ops.append(OB); size -= 1
    elif r < 0.9: ops.append(G(rng.choice([rng.randint(0, 20), size - 1 - rng.randint(0, 20), rng.randint(0, size - 1)])))
    else: ops.append(rng.choice([F, B, SZ]))
ops += [SZ, RZ(6, 1), A]
tests.append(case("h-large-both-ends", True, ops, "resize to 5 * 10^6, then 2500 operations, mostly at the front."))
# Large: build entirely from the front, so every growth happens with the buffer wrapped.
ops = [PF(v % 1000) for v in range(2200)] + [G(0), G(1), G(1100), G(2199), F, B] + [OB, OF] * 300 + [SZ, F, B]
tests.append(case("h-large-push-front", True, ops, "2200 pushFronts, then pops from both ends."))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
