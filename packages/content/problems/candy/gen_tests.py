"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def brute(r):
    """Fixed-point relaxation from all ones (independent of the two-pass idea)."""
    c = [1] * len(r); changed = True
    while changed:
        changed = False
        for i in range(len(r)):
            for j in (i - 1, i + 1):
                if 0 <= j < len(r) and r[i] > r[j] and c[i] <= c[j]:
                    c[i] = c[j] + 1; changed = True
    return sum(c)

def case(id, hidden, r, explanation=None):
    exp = mod.Solution().candy(list(r))
    if len(r) <= 400: assert exp == brute(r)
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "candy", "args": [r]}], "expected": [exp]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(135)
for _ in range(3000):
    r = [rng.randint(0, 4) for _ in range(rng.randint(1, 9))]
    assert mod.Solution().candy(r) == brute(r)

tests = [
    case("s1", False, [1, 0, 2], "2, 1, 2"),
    case("s2", False, [1, 2, 2], "1, 2, 1: equal neighbours have no constraint."),
    case("s3", False, [1, 3, 4, 5, 2], "1, 2, 3, 4, 1"),
    case("h-single", True, [7]),
    case("h-decreasing", True, [5, 4, 3, 2, 1], "A single left-to-right pass misses this."),
    case("h-increasing", True, [1, 2, 3, 4, 5]),
    case("h-all-equal", True, [3, 3, 3, 3]),
    case("h-peak-long-left", True, [1, 2, 3, 4, 5, 3], "The peak keeps its larger left-side count (max, not overwrite)."),
    case("h-peak-long-right", True, [1, 6, 5, 4, 3, 2]),
    case("h-valleys", True, [3, 1, 3, 1, 3]),
    case("h-plateau-peak", True, [1, 3, 3, 1]),
]
for k, n in enumerate([20, 100, 400, 400]):
    tests.append(case(f"h-rand-{k}", True, [rng.randint(0, 20000 if k % 2 else 5) for _ in range(n)]))
tests.append(case("h-large-random", True, [rng.randint(0, 20000) for _ in range(20000)]))
tests.append(case("h-large-mountain", True, list(range(10000)) + list(range(10000, -1, -1)), "Answer ~10^8."))
saw = []
for _ in range(200): saw += list(range(50)) + list(range(50, 0, -1))
tests.append(case("h-large-sawtooth", True, saw))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
