"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def brute(t):
    out = []
    for i in range(len(t)):
        out.append(next((j - i for j in range(i + 1, len(t)) if t[j] > t[i]), 0))
    return out

def case(id, hidden, t, explanation=None):
    exp = mod.Solution().dailyTemperatures(list(t))
    if len(t) <= 3000: assert exp == brute(t)
    tc = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "dailyTemperatures", "args": [t]}], "expected": [exp]}
    if explanation: tc["explanation"] = explanation
    return tc

rng = random.Random(739)
for _ in range(3000):
    t = [rng.randint(0, 5) for _ in range(rng.randint(1, 10))]
    assert mod.Solution().dailyTemperatures(t) == brute(t)

tests = [
    case("s1", False, [70, 68, 72, 71, 69, 75]),
    case("s2", False, [50, 50, 50], "Equal temperatures are not warmer."),
    case("s3", False, [30, 40, 50]),
    case("h-single", True, [0]),
    case("h-descending", True, [60, 50, 40, 30, 20]),
    case("h-negatives", True, [-50, -49, -50, -48]),
    case("h-equal-then-warmer", True, [10, 10, 10, 11]),
    case("h-valley", True, [5, 3, 1, 2, 4, 6]),
]
for k, n in enumerate([20, 200, 2000, 3000]):
    tests.append(case(f"h-rand-{k}", True, [rng.randint(-50, 60) for _ in range(n)]))
desc = [60 - (i * 110) // 12000 for i in range(12000)] + [60]
tests.append(case("h-large-desc-then-peak", True, desc, "Non-increasing run of 12000 days, then one warmer day: brute force is quadratic."))
tests.append(case("h-large-flat", True, [7] * 12000))
tests.append(case("h-large-random", True, [rng.randint(-50, 60) for _ in range(12000)]))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
