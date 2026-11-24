"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def case(id, hidden, nums, explanation=None):
    exp = sorted(nums)
    assert mod.Solution().sortColors(list(nums)) == exp
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "sortColors", "args": [nums]}], "expected": [exp]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(75)
for _ in range(5000):
    a = [rng.randint(0, 2) for _ in range(rng.randint(1, 10))]
    assert mod.Solution().sortColors(list(a)) == sorted(a)

tests = [
    case("s1", False, [2, 0, 2, 1, 1, 0]),
    case("s2", False, [1, 2, 0]),
    case("s3", False, [2]),
    case("h-201", True, [2, 0, 1], "After swapping the 2 to the back, the 1 that arrives must still be examined."),
    case("h-all-zero", True, [0, 0, 0]),
    case("h-all-two", True, [2, 2, 2, 2]),
    case("h-reverse", True, [2, 2, 1, 1, 0, 0]),
    case("h-sorted", True, [0, 1, 2]),
    case("h-two-zero", True, [2, 0]),
    case("h-no-ones", True, [2, 0, 2, 0, 0, 2]),
]
for k, n in enumerate([10, 100, 1000, 10000]):
    tests.append(case(f"h-rand-{k}", True, [rng.randint(0, 2) for _ in range(n)]))
tests.append(case("h-large", True, [rng.randint(0, 2) for _ in range(50000)]))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
