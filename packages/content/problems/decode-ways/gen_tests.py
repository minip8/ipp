"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib
from functools import lru_cache

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
CODES = {str(k) for k in range(1, 27)}


def brute(s):
    """Independent check: memoised recursion over the set of valid codes."""
    @lru_cache(None)
    def go(i):
        if i == len(s):
            return 1
        return sum(go(i + L) for L in (1, 2) if s[i:i + L] in CODES and i + L <= len(s))
    return go(0)


def case(id, hidden, s, explanation=None):
    got = mod.Solution().numDecodings(s)
    assert got == brute(s), s
    assert got < 2**31, s
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "numDecodings", "args": [s]}],
         "expected": [got]}
    if explanation: t["explanation"] = explanation
    return t


rng = random.Random(91)
for _ in range(2000):
    s = "".join(rng.choice("0123456789" if rng.random() < .5 else "0112226") for _ in range(rng.randint(1, 12)))
    assert mod.Solution().numDecodings(s) == brute(s)


def bounded_random(rng, n, alphabet):
    """Random digit string of length n whose answer fits in 32 bits."""
    while True:
        s = "".join(rng.choice(alphabet) for _ in range(n))
        if brute(s) < 2**31:
            return s


tests = [
    case("s1", False, "226", "2|26, 22|6 and 2|2|6."),
    case("s2", False, "105", "Only 10|5; '05' is not a code."),
    case("s3", False, "30", "'30' is above 26 and '0' alone is not a code."),
    case("h-zero", True, "0"),
    case("h-leading-zero", True, "06"),
    case("h-ten", True, "10"),
    case("h-twenty-seven", True, "27", "27 is not a code, so only 2|7."),
    case("h-double-zero", True, "100"),
    case("h-zero-inside", True, "1001"),
    case("h-2101", True, "2101", "2|10|1 only."),
    case("h-all-pairs", True, "1111111111"),
    case("h-ones-45", True, "1" * 45, "About 1.8 * 10^9 decodings: naive recursion is far too slow."),
    case("h-twos-44", True, "2" * 44),
    case("h-mixed-big", True, "12" * 22 + "6"),
    case("h-no-pairs", True, "3456789" * 14 + "34"),
    case("h-ends-with-zero-bad", True, "1" * 40 + "30"),
    case("h-many-tens", True, "10" * 50),
    case("h-single-digit", True, "7"),
]
for k in range(8):
    n = [5, 10, 20, 40, 60, 80, 100, 100][k]
    tests.append(case(f"h-rand-{k}", True, bounded_random(rng, n, "1234567891234567890" if k % 2 else "123345678934567892")))
tests.append(case("h-rand-dense-100", True, bounded_random(rng, 100, "12345678" + "9" * 4)))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
