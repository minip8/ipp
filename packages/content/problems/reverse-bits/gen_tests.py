"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def brute(n):
    return int(format(n, "032b")[::-1], 2)

def case(id, hidden, n, explanation=None):
    exp = brute(n)
    assert mod.Solution().reverseBits(n) == exp
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "reverseBits", "args": [n]}], "expected": [exp]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(190)
tests = [
    case("s1", False, 1, "Bit 0 moves to bit 31."),
    case("s2", False, 6, "Bits 1 and 2 move to bits 30 and 29."),
    case("s3", False, 4294967295, "All ones stay all ones."),
    case("h-zero", True, 0),
    case("h-top-bit", True, 2147483648),
    case("h-pattern-a", True, 0xAAAAAAAA),
    case("h-pattern-5", True, 0x55555555),
    case("h-low-half", True, 0x0000FFFF),
    case("h-high-half", True, 0xFFFF0000),
    case("h-palindrome", True, 0x80000001),
    case("h-small", True, 43261596),
    case("h-sign-bit-mix", True, 0xF0000001),
]
for k in range(10):
    tests.append(case(f"h-rand-{k}", True, rng.getrandbits(32)))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
