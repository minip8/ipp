"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib, sys
sys.set_int_max_str_digits(0)

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def case(id, hidden, a, b, explanation=None):
    exp = str(int(a) * int(b))
    assert mod.Solution().multiply(a, b) == exp
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "multiply", "args": [a, b]}], "expected": [exp]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(43)
def num(n):
    return str(rng.randint(1, 9)) + "".join(rng.choice("0123456789") for _ in range(n - 1)) if n > 1 else str(rng.randint(0, 9))
for _ in range(3000):
    a, b = num(rng.randint(1, 6)), num(rng.randint(1, 6))
    assert mod.Solution().multiply(a, b) == str(int(a) * int(b))

tests = [
    case("s1", False, "12", "34"),
    case("s2", False, "999", "999"),
    case("s3", False, "0", "52", "Zero times anything is \"0\", not \"00\"."),
    case("h-zero-right", True, "123456789", "0"),
    case("h-ones", True, "1", "1"),
    case("h-one-identity", True, "1", "98765432109876543210"),
    case("h-power-of-ten", True, "1000", "100"),
    case("h-past-64-bit", True, "18446744073709551616", "18446744073709551616", "2^64 squared."),
    case("h-nines", True, "9" * 50, "9" * 50),
    case("h-carry-chain", True, "5" * 30, "2"),
]
for k, (n, m) in enumerate([(5, 7), (40, 3), (120, 130), (500, 2)]):
    tests.append(case(f"h-rand-{k}", True, num(n), num(m)))
tests.append(case("h-large", True, num(1000), num(1000), "10^6 digit products; repeated string additions are slow."))
tests.append(case("h-large-nines", True, "9" * 1000, "9" * 1000))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
