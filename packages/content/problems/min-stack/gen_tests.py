"""Regenerates tests.json deterministically from the Python reference solution.

Every sequence is replayed against a brute-force model (a list, min() by scanning) and both must agree.
"""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

INT_MIN, INT_MAX = -2**31, 2**31 - 1


class Model:
    def __init__(self): self.a = []
    def push(self, v): self.a.append(v)
    def pop(self): self.a.pop()
    def top(self): return self.a[-1]
    def getMin(self): return min(self.a)


def run(cls, ops):
    obj = cls()
    return [getattr(obj, m)(*a) for m, a in ops]


def case(id, hidden, ops, explanation=None):
    expected = run(mod.MinStack, ops)
    assert expected == run(Model, ops), id
    t = {"id": id, "hidden": hidden, "ctorArgs": [],
         "calls": [{"method": m, "args": a} for m, a in ops], "expected": expected}
    if explanation: t["explanation"] = explanation
    return t


def random_ops(rng, n, lo, hi, push_bias=0.5):
    ops, size = [], 0
    for _ in range(n):
        r = rng.random()
        if size == 0 or r < push_bias:
            ops.append(("push", [rng.randint(lo, hi)])); size += 1
        elif r < push_bias + (1 - push_bias) / 3:
            ops.append(("pop", [])); size -= 1
        elif r < push_bias + 2 * (1 - push_bias) / 3:
            ops.append(("top", []))
        else:
            ops.append(("getMin", []))
    return ops


Pu = lambda v: ("push", [v])
Po = ("pop", [])
T = ("top", [])
M = ("getMin", [])
rng = random.Random(155)

for _ in range(300):
    ops = random_ops(rng, 50, -5, 5)
    assert run(mod.MinStack, ops) == run(Model, ops)

tests = [
    case("s1", False, [Pu(4), Pu(2), Pu(7), M, Pu(2), Po, M, Po, Po, M, T],
         "Popping one copy of 2 leaves the other, so the minimum stays 2 until it is popped too."),
    case("s2", False, [Pu(-1), T, M, Pu(-3), M, T, Po, M],
         "After -3 is popped the minimum returns to -1."),
    case("h-single", True, [Pu(5), T, M]),
    case("h-dup-min", True, [Pu(1), Pu(1), Pu(1), Po, M, Po, M, Pu(2), M, T],
         "Duplicates of the minimum: breaks a min-stack that only records strictly smaller values."),
    case("h-extremes", True, [Pu(INT_MAX), Pu(INT_MIN), M, T, Po, M, Pu(INT_MIN), Pu(INT_MAX), M, T, Po, Po, M],
         "Values at the 32-bit limits: breaks difference-encoding tricks done in int."),
    case("h-decreasing", True, [Pu(v) for v in range(10, 0, -1)] + [x for _ in range(9) for x in (M, Po)] + [M]),
    case("h-increasing", True, [Pu(v) for v in range(1, 11)] + [x for _ in range(9) for x in (M, T, Po)] + [M]),
    case("h-refill", True, [Pu(3), Po, Pu(8), M, Pu(6), M, Po, Po, Pu(9), M, T]),
]
for k, (n, lo, hi) in enumerate([(30, -3, 3), (60, -10, 10), (150, -100, 100), (400, 0, 5), (800, INT_MIN, INT_MAX)]):
    tests.append(case(f"h-rand-{k}", True, random_ops(rng, n, lo, hi)))
tests.append(case("h-deep", True, random_ops(rng, 1200, -10**9, 10**9, push_bias=0.7)))
tests.append(case("h-large", True, random_ops(rng, 2800, -10**6, 10**6, push_bias=0.55)))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
