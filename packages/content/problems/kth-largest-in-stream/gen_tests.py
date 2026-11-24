"""Regenerates tests.json deterministically from the Python reference solution.

Every sequence is replayed against a brute-force model (a fully sorted list of every value).
"""
import bisect, json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


class Model:
    """Keeps every value in a sorted list (bisect.insort); answer is a[-k]."""
    def __init__(self, k, nums): self.k, self.a = k, sorted(nums)
    def add(self, v):
        bisect.insort(self.a, v)
        return self.a[-self.k]


def run(cls, k, nums, vals):
    obj = cls(k, list(nums))
    return [obj.add(v) for v in vals]


def case(id, hidden, k, nums, vals, explanation=None):
    expected = run(mod.KthLargest, k, nums, vals)
    assert expected == run(Model, k, nums, vals), id
    t = {"id": id, "hidden": hidden, "ctorArgs": [k, nums],
         "calls": [{"method": "add", "args": [v]} for v in vals], "expected": expected}
    if explanation: t["explanation"] = explanation
    return t


rng = random.Random(703)
R = lambda n, lo=-10**4, hi=10**4: [rng.randint(lo, hi) for _ in range(n)]

for _ in range(300):
    k = rng.randint(1, 6)
    nums = R(rng.randint(k - 1, 10), -5, 5)
    vals = R(20, -6, 6)
    assert run(mod.KthLargest, k, nums, vals) == run(Model, k, nums, vals)

tests = [
    case("s1", False, 3, [6, 1, 9, 4], [2, 7, 10, 7, 0],
         "After adding 2 the scores are 9 6 4 2 1, so the 3rd largest is 4."),
    case("s2", False, 2, [5], [5, 3, 6],
         "Duplicates count separately: in 5 5 the 2nd largest is 5."),
    case("h-empty-start", True, 1, [], [-3, -5, 2, 2, -10**4],
         "k = 1 with no initial scores: the heap starts empty."),
    case("h-short-start", True, 4, [1, 2, 3], [0, 5, -1, 4, 4]),
    case("h-all-equal", True, 3, [7, 7, 7, 7], [7, 7, 7]),
    case("h-descending-adds", True, 5, list(range(10)), list(range(-1, -30, -1)),
         "Small adds never change the answer."),
    case("h-ascending-adds", True, 5, list(range(10)), list(range(10, 60))),
    case("h-k-equals-n", True, 6, R(5), R(30)),
    case("h-extremes", True, 2, [10**4, -10**4], [-10**4, 10**4, 0, -10**4]),
]
for i, (k, n, m) in enumerate([(1, 10, 30), (3, 20, 60), (10, 50, 200), (50, 200, 500), (100, 99, 500)]):
    tests.append(case(f"h-rand-{i}", True, k, R(n), R(m)))
tests.append(case("h-small-range", True, 20, R(100, -3, 3), R(800, -3, 3)))
# Large: big k and many adds; re-sorting on every add is far too slow at the stated limits.
tests.append(case("h-large", True, 3000, R(8000), R(2200)))
tests.append(case("h-large-k1", True, 1, R(5000), R(1500)))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
