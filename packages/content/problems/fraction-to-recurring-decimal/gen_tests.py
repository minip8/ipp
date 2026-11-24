"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib, sys
sys.set_int_max_str_digits(0)
from fractions import Fraction

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def parse(s):
    """Inverse: turn our output format back into a Fraction, to check round-tripping."""
    neg = s.startswith("-"); s = s.lstrip("-")
    if "." not in s: v = Fraction(int(s))
    else:
        whole, frac = s.split(".")
        if "(" in frac:
            pre, rep = frac.rstrip(")").split("(")
            v = Fraction(int(whole)) + Fraction(int(pre or "0"), 10 ** len(pre)) + Fraction(int(rep), (10 ** len(rep) - 1) * 10 ** len(pre))
        else:
            v = Fraction(int(whole)) + Fraction(int(frac), 10 ** len(frac))
    return -v if neg else v

def well_formed(s):
    """Shortest block and earliest start: block is not a repetition of a smaller block, and the last
    pre-period digit differs from the last block digit (else the parenthesis could start earlier)."""
    if "(" not in s: return not ("." in s and s.endswith("0"))
    pre, rep = s.split(".")[1].rstrip(")").split("(")
    if any(len(rep) % k == 0 and rep == rep[:k] * (len(rep) // k) for k in range(1, len(rep))): return False
    return not pre or pre[-1] != rep[-1]

def case(id, hidden, a, b, explanation=None):
    exp = mod.Solution().fractionToDecimal(a, b)
    assert parse(exp) == Fraction(a, b) and well_formed(exp) and exp != "-0" and len(exp) <= 10**5, (a, b, exp)
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "fractionToDecimal", "args": [a, b]}], "expected": [exp]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(166)
for _ in range(5000):
    a, b = rng.randint(-500, 500), rng.choice([x for x in range(-200, 201) if x])
    e = mod.Solution().fractionToDecimal(a, b)
    assert parse(e) == Fraction(a, b) and well_formed(e), (a, b, e)

M, m = 2**31 - 1, -2**31
tests = [
    case("s1", False, 1, 4),
    case("s2", False, 4, 2, "An integer: no decimal point."),
    case("s3", False, 1, 6, "The 1 doesn't repeat; the 6 does."),
    case("s4", False, -22, 7),
    case("h-example-5", True, 1, 333, "Repeated 0 digits are not the cycle; repeated remainders are."),
    case("h-zero-neg-den", True, 0, -5, "Zero has no sign."),
    case("h-neg-less-than-one", True, -1, 4, "Integer part 0 but still negative."),
    case("h-both-negative", True, -50, -8),
    case("h-int-min-by-minus-one", True, m, -1, "2147483648 does not fit in 32 bits."),
    case("h-int-min-by-one", True, m, 1),
    case("h-one-by-int-min", True, 1, m),
    case("h-int-min-by-int-min", True, m, m),
    case("h-max-by-min", True, M, m),
    case("h-sevenths", True, 1, 7),
    case("h-long-cycle", True, 1, 97, "Cycle of length 96."),
    case("h-pre-period", True, 1, 12),
    case("h-ninety", True, 7, 90),
    case("h-int-plus-cycle", True, 10, 3),
    case("h-terminating-long", True, 1, 1024),
]
for k in range(8):
    tests.append(case(f"h-rand-{k}", True, rng.randint(m, M), rng.choice([rng.randint(1, 1000), -rng.randint(1, 1000), rng.randint(1, 50000)])))
tests.append(case("h-large-cycle", True, -3, 49993, "49993 is a full-reptend prime: the cycle has 49992 digits."))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
