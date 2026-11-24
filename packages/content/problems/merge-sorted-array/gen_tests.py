"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def case(id, hidden, a, b, explanation=None):
    m, n = len(a), len(b)
    nums1 = a + [0] * n
    exp = sorted(a + b)
    assert mod.Solution().merge(list(nums1), m, list(b), n) == exp
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "merge", "args": [nums1, m, b, n]}], "expected": [exp]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(88)
def srt(n, lo=-10**9, hi=10**9):
    return sorted(rng.randint(lo, hi) for _ in range(n))
for _ in range(3000):
    a, b = srt(rng.randint(0, 5), -3, 3), srt(rng.randint(0, 5), -3, 3)
    if a or b: case("x", True, a, b)

tests = [
    case("s1", False, [1, 4, 7], [2, 5, 6]),
    case("s2", False, [5], [], "Nothing to merge."),
    case("s3", False, [], [-3, 8], "m = 0: the zeros in nums1 are only placeholders."),
    case("h-all-b-smaller", True, [10, 20, 30], [1, 2, 3]),
    case("h-all-b-larger", True, [1, 2, 3], [10, 20, 30]),
    case("h-duplicates", True, [1, 2, 2, 3], [2, 2, 4]),
    case("h-placeholder-trap", True, [-5, -1], [-3, 0], "The value 0 appears both as real data and as placeholders."),
    case("h-negatives", True, [-9, -8], [-10, -7, -1]),
    case("h-single-each", True, [2], [1]),
]
for k, (m, n) in enumerate([(5, 5), (50, 3), (300, 700), (1000, 1000)]):
    tests.append(case(f"h-rand-{k}", True, srt(m), srt(n)))
tests.append(case("h-large", True, srt(3500), srt(3000)))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
