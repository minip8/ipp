"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib, math
from fractions import Fraction

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def exact(x, n):
    """Exact value via Fractions when |n| is small enough, else math.pow (true value is tiny/moderate)."""
    if abs(n) <= 2000:
        f = Fraction(x) ** n
        return float(f)
    return math.pow(x, n)

def close(a, b):
    return abs(a - b) <= 1e-6 or abs(a - b) <= 1e-6 * max(abs(a), abs(b))

def case(id, hidden, x, n, explanation=None):
    exp = exact(x, n)
    assert abs(exp) <= 1e4
    got = mod.Solution().myPow(x, n)
    assert close(got, exp), (x, n, got, exp)
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "myPow", "args": [x, n]}], "expected": [exp]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(50)
M, m = 2**31 - 1, -2**31
tests = [
    case("s1", False, 2.0, 10),
    case("s2", False, 2.1, 3),
    case("s3", False, 2.0, -2),
    case("s4", False, -1.0, m, "|n| doesn't fit in a 32-bit int; also (-1)^even = 1."),
    case("h-n-zero", True, 37.5, 0),
    case("h-zero-base", True, 0.0, 5),
    case("h-one-max", True, 1.0, M),
    case("h-minus-one-odd", True, -1.0, M),
    case("h-half-max", True, 0.5, M, "Underflows to 0."),
    case("h-two-min", True, 2.0, m, "2^-2147483648 is 0 for practical purposes."),
    case("h-near-one-big-n", True, 1.0000001, 2147483, "About e^0.2147."),
    case("h-near-one-negative", True, 0.99999, -500000),
    case("h-negative-base-odd", True, -2.0, 13),
    case("h-negative-base-neg-exp", True, -3.0, -5),
    case("h-fraction", True, 0.1, 4),
]
k = 0
while k < 10:
    x = round(rng.uniform(-3, 3), 3); n = rng.randint(-40, 40)
    if x == 0 or abs(exact(x, n)) > 1e4: continue
    tests.append(case(f"h-rand-{k}", True, x, n)); k += 1
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
