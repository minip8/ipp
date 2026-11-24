"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def brute(h):
    return max(min(h[i], h[j]) * (j - i) for i in range(len(h)) for j in range(i + 1, len(h)))

def case(id, hidden, h, explanation=None):
    exp = mod.Solution().maxArea(list(h))
    if len(h) <= 1500: assert exp == brute(h)
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "maxArea", "args": [h]}], "expected": [exp]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(11)
for _ in range(3000):
    h = [rng.randint(0, 9) for _ in range(rng.randint(2, 9))]
    assert mod.Solution().maxArea(h) == brute(h)

tests = [
    case("s1", False, [2, 7, 3, 6, 4, 1], "Walls 1 and 3 (6 * 2) or walls 1 and 4 (4 * 3)."),
    case("s2", False, [1, 1]),
    case("s3", False, [5, 1, 1, 1, 5], "The outer walls: 5 * 4."),
    case("h-zeros", True, [0, 0, 0]),
    case("h-one-zero", True, [0, 10000]),
    case("h-increasing", True, list(range(1, 21))),
    case("h-decreasing", True, list(range(20, 0, -1))),
    case("h-tall-middle", True, [1, 10000, 10000, 1], "The two tall middle walls win."),
    case("h-equal-ends-inner-better", True, [3, 9, 1, 1, 9, 3]),
    case("h-move-taller-trap", True, [4, 3, 2, 1, 4]),
]
for k, n in enumerate([10, 100, 1000, 1500]):
    tests.append(case(f"h-rand-{k}", True, [rng.randint(0, 10000) for _ in range(n)]))
tests.append(case("h-large-random", True, [rng.randint(0, 10000) for _ in range(15000)]))
tests.append(case("h-large-max", True, [10000] * 10000))
valley = [abs(i - 6000) for i in range(12000)]
tests.append(case("h-large-valley", True, valley))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
