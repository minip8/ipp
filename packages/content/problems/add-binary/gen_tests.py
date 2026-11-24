"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def case(id, hidden, a, b, explanation=None):
    exp = bin(int(a, 2) + int(b, 2))[2:]
    assert mod.Solution().addBinary(a, b) == exp
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "addBinary", "args": [a, b]}], "expected": [exp]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(67)
def num(n):
    return "1" + "".join(rng.choice("01") for _ in range(n - 1)) if n > 1 else rng.choice("01")
for _ in range(3000):
    a, b = num(rng.randint(1, 8)), num(rng.randint(1, 8))
    assert mod.Solution().addBinary(a, b) == bin(int(a, 2) + int(b, 2))[2:]

tests = [
    case("s1", False, "1011", "110", "11 + 6 = 17"),
    case("s2", False, "0", "0"),
    case("s3", False, "1111", "1", "The carry ripples out into a new leading digit."),
    case("h-one-one", True, "1", "1"),
    case("h-zero-left", True, "0", "101"),
    case("h-zero-right", True, "1101", "0"),
    case("h-no-carry", True, "1010", "101"),
    case("h-diff-len", True, "1", "111111"),
    case("h-64bit-overflow", True, "1" * 64, "1", "Exceeds 64-bit integer range."),
]
for k, (n, m) in enumerate([(10, 7), (40, 40), (100, 3), (1000, 999)]):
    tests.append(case(f"h-rand-{k}", True, num(n), num(m)))
tests.append(case("h-large-ripple", True, "1" * 10000, "1"))
tests.append(case("h-large", True, num(10000), num(10000)))
tests.append(case("h-large-uneven", True, num(10000), num(37)))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
