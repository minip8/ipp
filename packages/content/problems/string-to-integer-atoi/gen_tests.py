"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib, re

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def brute(s):
    m = re.match(r" *([+-]?)(\d+)", s)
    if not m: return 0
    v = int(m.group(2)) * (-1 if m.group(1) == "-" else 1)
    return max(-2**31, min(2**31 - 1, v))

def case(id, hidden, s, explanation=None):
    exp = brute(s)
    assert mod.Solution().myAtoi(s) == exp, (s, exp)
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "myAtoi", "args": [s]}], "expected": [exp]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(8)
ALPHA = " +-.0123456789ab"
for _ in range(20000):
    s = "".join(rng.choice(ALPHA) for _ in range(rng.randint(0, 14)))
    assert mod.Solution().myAtoi(s) == brute(s), s
for v in [2**31 - 1, 2**31, 2**31 + 1, -2**31, -2**31 - 1, 10**10, 2147483650, 2147483639, 2147483657]:
    for s in [str(v), "+" + str(v) if v >= 0 else str(v)]:
        assert mod.Solution().myAtoi(s) == brute(s)

tests = [
    case("s1", False, "   -0042xyz", "Spaces skipped, sign read, leading zeros allowed, stops at 'x'."),
    case("s2", False, "+17 apples"),
    case("s3", False, "words 99", "The first non-space character is not a sign or digit."),
    case("s4", False, "-91283472332", "Clamped to -2^31."),
    case("h-example-5", True, "+-5", "Only one sign character is allowed."),
    case("h-example-6", True, "  +  3", "Spaces after the sign stop parsing."),
    case("h-empty", True, ""),
    case("h-spaces", True, "     "),
    case("h-sign-only", True, "-"),
    case("h-int-max", True, "2147483647"),
    case("h-int-max-plus-1", True, "2147483648"),
    case("h-int-min", True, "-2147483648", "Exactly representable: must not clamp to -2147483647."),
    case("h-int-min-minus-1", True, "-2147483649"),
    case("h-max-last-digit-boundary", True, "2147483650"),
    case("h-just-below-max", True, "2147483646"),
    case("h-decimal", True, "3.99"),
    case("h-leading-dot", True, ".5"),
    case("h-zeros", True, "0000000000000000000000000000000000000012"),
    case("h-long-digits", True, "9" * 200, "Overflows even a 64-bit accumulator."),
    case("h-long-negative", True, "-" + "1" * 199),
    case("h-zero-negative", True, "-0"),
    case("h-plus-zero-then", True, "+0 123"),
    case("h-digits-letters", True, "123abc456"),
    case("h-minus-letter", True, "-a1"),
    case("h-inner-space", True, "12 34"),
    case("h-max-with-tail", True, "  +2147483647.0"),
]
for k in range(8):
    tests.append(case(f"h-rand-{k}", True, " " * rng.randint(0, 3) + rng.choice(["", "+", "-"]) + "".join(rng.choice("0123456789") for _ in range(rng.randint(1, 12))) + rng.choice(["", "x", " 5", ".7"])))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
