"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def brute(h):
    return sum(min(max(h[:i + 1]), max(h[i:])) - h[i] for i in range(len(h)))

def prefix_version(h):
    n = len(h); L = h[:]; R = h[:]
    for i in range(1, n): L[i] = max(L[i - 1], h[i])
    for i in range(n - 2, -1, -1): R[i] = max(R[i + 1], h[i])
    return sum(min(L[i], R[i]) - h[i] for i in range(n))

def case(id, hidden, h, explanation=None):
    exp = mod.Solution().trap(list(h))
    assert exp == prefix_version(h)
    if len(h) <= 1000: assert exp == brute(h)
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "trap", "args": [h]}], "expected": [exp]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(42)
for _ in range(3000):
    h = [rng.randint(0, 6) for _ in range(rng.randint(1, 10))]
    assert mod.Solution().trap(h) == brute(h)

tests = [
    case("s1", False, [3, 0, 2, 0, 4], "3 + 1 + 3 units: the level is capped by the left bar of height 3."),
    case("s2", False, [0, 1, 0, 2, 1, 0, 1, 3, 2, 1, 2, 1]),
    case("s3", False, [5, 4, 3], "Nothing on the right to hold the water."),
    case("h-single", True, [7]),
    case("h-two", True, [5, 5]),
    case("h-flat", True, [2, 2, 2, 2]),
    case("h-valley", True, [5, 0, 0, 0, 5]),
    case("h-asymmetric", True, [2, 0, 9, 0, 0, 3]),
    case("h-increasing", True, [0, 1, 2, 3, 4]),
    case("h-peak-middle", True, [1, 3, 5, 3, 1]),
    case("h-nested-pools", True, [4, 1, 3, 1, 5, 0, 2, 1, 4]),
]
for k, n in enumerate([20, 200, 1000, 1000]):
    tests.append(case(f"h-rand-{k}", True, [rng.randint(0, 100000 if k % 2 else 50) for _ in range(n)]))
tests.append(case("h-large-overflow", True, [100000] + [0] * 25000 + [100000], "2.5 * 10^9 units: needs 64 bits."))
tests.append(case("h-large-random", True, [rng.randint(0, 100000) for _ in range(10000)]))
mount = [min(i, 12000 - i) for i in range(12000)]
tests.append(case("h-large-mountain", True, mount, "A single peak: no water at all."))
tests.append(case("h-large-v", True, [abs(i - 6000) for i in range(12001)]))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
