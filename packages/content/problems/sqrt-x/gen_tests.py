"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib, math

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def case(id, hidden, x, explanation=None):
    exp = math.isqrt(x)
    assert mod.Solution().mySqrt(x) == exp
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "mySqrt", "args": [x]}], "expected": [exp]}
    if explanation: t["explanation"] = explanation
    return t

for x in range(0, 20000):
    assert mod.Solution().mySqrt(x) == math.isqrt(x)

rng = random.Random(69)
M = 2**53 - 1
r = math.isqrt(M)
tests = [
    case("s1", False, 16),
    case("s2", False, 27, "5*5 = 25 <= 27 < 36 = 6*6"),
    case("s3", False, 0),
    case("s4", False, 10**12),
    case("h-one", True, 1),
    case("h-two", True, 2),
    case("h-three", True, 3),
    case("h-just-below-square", True, 35),
    case("h-int32-max", True, 2**31 - 1),
    case("h-int32-square-boundary", True, 46341 * 46341 - 1),
    case("h-max", True, M, "Largest input; mid*mid can overflow if the upper bound is x."),
    case("h-max-square", True, r * r),
    case("h-max-square-minus1", True, r * r - 1),
    case("h-float-trap", True, 94906265**2 - 1, "Floating-point sqrt rounds this up to 94906265."),
    case("h-perfect-square-big", True, 94906265**2),
    case("h-float-trap-2", True, 67108865**2 - 1),
]
for k in range(10):
    tests.append(case(f"h-rand-{k}", True, rng.randint(0, M)))
for k in range(4):
    q = rng.randint(10**6, r); tests.append(case(f"h-near-square-{k}", True, q * q - 1))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
