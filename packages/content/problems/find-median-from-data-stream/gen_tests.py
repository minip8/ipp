"""Regenerates tests.json deterministically from the Python reference solution.

Every operation sequence is replayed against a brute-force model (sort on every query) and the two
must agree before anything is written.
"""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


class Model:
    def __init__(self):
        self.xs = []

    def addNum(self, num):
        self.xs.append(num)

    def findMedian(self):
        s = sorted(self.xs)
        n = len(s)
        return float(s[n // 2]) if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2.0


def run(cls, ops):
    obj = cls()
    return [getattr(obj, m)(*a) for m, a in ops]


def case(id, hidden, ops, explanation=None):
    expected = run(mod.MedianFinder, ops)
    assert expected == run(Model, ops), id
    t = {"id": id, "hidden": hidden, "ctorArgs": [],
         "calls": [{"method": m, "args": a} for m, a in ops], "expected": expected}
    if explanation: t["explanation"] = explanation
    return t


def from_values(values, query_every=1):
    ops = []
    for i, v in enumerate(values):
        ops.append(("addNum", [v]))
        if (i + 1) % query_every == 0:
            ops.append(("findMedian", []))
    if ops[-1][0] != "findMedian":
        ops.append(("findMedian", []))
    return ops


def random_ops(rng, n, lo, hi, query_ratio=0.5):
    ops = [("addNum", [rng.randint(lo, hi)])]
    for _ in range(n - 1):
        if rng.random() < query_ratio:
            ops.append(("findMedian", []))
        else:
            ops.append(("addNum", [rng.randint(lo, hi)]))
    return ops


rng = random.Random(295)
for _ in range(300):
    ops = random_ops(rng, 60, -20, 20)
    assert run(mod.MedianFinder, ops) == run(Model, ops)

tests = [
    case("s1", False, from_values([5, 1, 9, 2]), "Medians of [5], [1,5], [1,5,9], [1,2,5,9]."),
    case("s2", False, from_values([-3, -4]), "(-4 + -3) / 2 = -3.5, not -3."),
    case("s3", False, from_values([7, 7, 7, 1, 1], query_every=5), "Sorted 1 1 7 7 7: the median is the middle 7."),
    case("h-single", True, from_values([0])),
    case("h-negative-half", True, from_values([-1, 0]), "Average -0.5: integer division would give 0 or -1."),
    case("h-ascending", True, from_values(list(range(1, 41)))),
    case("h-descending", True, from_values(list(range(40, 0, -1)))),
    case("h-extremes", True, from_values([100000, -100000, 100000, -100000, 99999, -99999])),
    case("h-duplicates", True, from_values([3] * 15 + [1] * 10 + [5] * 12)),
    case("h-alternating", True, from_values([(-1) ** i * i for i in range(60)])),
]
for k, (n, lo, hi) in enumerate([(50, -10, 10), (200, -1000, 1000), (500, -5, 5), (1000, -10**5, 10**5)]):
    tests.append(case(f"h-rand-{k}", True, random_ops(rng, n, lo, hi)))
# Larger: 3000 inserts with periodic queries; size is bounded by the tests.json budget.
big = [rng.randint(-10**5, 10**5) for _ in range(3000)]
tests.append(case("h-large-inserts", True, from_values(big, query_every=40)))
tests.append(case("h-large-mixed", True, random_ops(rng, 2000, -10**5, 10**5, query_ratio=0.5)))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
