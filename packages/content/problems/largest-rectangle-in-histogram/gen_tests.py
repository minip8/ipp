"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def brute(h):
    best = 0
    for i in range(len(h)):
        m = h[i]
        for j in range(i, len(h)):
            m = min(m, h[j]); best = max(best, m * (j - i + 1))
    return best

def case(id, hidden, h, explanation=None):
    exp = mod.Solution().largestRectangleArea(list(h))
    if len(h) <= 2500: assert exp == brute(h)
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "largestRectangleArea", "args": [h]}], "expected": [exp]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(84)
for _ in range(3000):
    h = [rng.randint(0, 6) for _ in range(rng.randint(1, 10))]
    assert mod.Solution().largestRectangleArea(h) == brute(h)

tests = [
    case("s1", False, [2, 1, 5, 6, 2, 3], "Bars of height 5 and 6 give a 5 x 2 rectangle."),
    case("s2", False, [2, 4]),
    case("s3", False, [3, 3, 3, 1]),
    case("h-single-zero", True, [0]),
    case("h-single", True, [100000]),
    case("h-increasing", True, [1, 2, 3, 4, 5], "Nothing is popped until the end: the stack must be flushed."),
    case("h-decreasing", True, [5, 4, 3, 2, 1]),
    case("h-zeros-split", True, [4, 4, 0, 3, 3, 3]),
    case("h-equal", True, [6, 6, 6, 6]),
    case("h-valley", True, [6, 2, 5, 4, 5, 1, 6]),
    case("h-wide-low", True, [2, 1, 2, 1, 2, 1, 2, 1, 2]),
]
for k, (n, hi) in enumerate([(20, 10), (200, 1000), (2000, 100000), (2500, 50)]):
    tests.append(case(f"h-rand-{k}", True, [rng.randint(0, hi) for _ in range(n)]))
tests.append(case("h-large-overflow", True, [100000] * 21500, "Area 2.15 * 10^9 exceeds 2^31 - 1: needs 64 bits."))
tests.append(case("h-large-increasing", True, list(range(1, 8001)), "Sorted input: quadratic for naive divide and conquer."))
tests.append(case("h-large-random", True, [rng.randint(0, 100000) for _ in range(6000)]))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
