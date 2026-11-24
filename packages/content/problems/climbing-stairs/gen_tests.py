"""Regenerates tests.json deterministically from the Python reference solution."""
import json, importlib.util, pathlib
from functools import lru_cache

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


@lru_cache(None)
def brute(n):
    """Direct definition: count sequences of 1s and 2s summing to n."""
    if n < 0:
        return 0
    if n == 0:
        return 1
    return brute(n - 1) + brute(n - 2)


def case(id, hidden, n, explanation=None):
    got = mod.Solution().climbStairs(n)
    assert got == brute(n), (n, got)
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "climbStairs", "args": [n]}],
         "expected": [got]}
    if explanation: t["explanation"] = explanation
    return t


# Small cases checked by explicit enumeration too.
from itertools import product
for n in range(1, 13):
    count = sum(1 for k in range(n + 1) for seq in product((1, 2), repeat=k) if sum(seq) == n)
    assert count == brute(n) == mod.Solution().climbStairs(n)

tests = [
    case("s1", False, 2, "1+1 or 2."),
    case("s2", False, 4, "1+1+1+1, 1+1+2, 1+2+1, 2+1+1, 2+2."),
    case("s3", False, 1),
]
for n in [3, 5, 6, 10, 17, 25, 33, 38]:
    tests.append(case(f"h-n{n}", True, n))
tests.append(case("h-n44", True, 44, "Naive recursion makes over a billion calls here."))
tests.append(case("h-n45", True, 45, "Largest input; the answer is just below 2^31."))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
