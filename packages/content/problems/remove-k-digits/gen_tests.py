"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib
from itertools import combinations

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def brute(num, k):
    n = len(num)
    return str(min(int("".join(num[i] for i in keep) or "0") for keep in combinations(range(n), n - k)))

def case(id, hidden, num, k, explanation=None):
    exp = mod.Solution().removeKdigits(num, k)
    if len(num) <= 12: assert exp == brute(num, k)
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "removeKdigits", "args": [num, k]}], "expected": [exp]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(402)
def number(n, digits="0123456789"):
    if n == 1: return rng.choice(digits)
    return rng.choice(digits.replace("0", "") or "1") + "".join(rng.choice(digits) for _ in range(n - 1))
for _ in range(3000):
    num = number(rng.randint(1, 8), rng.choice(["0123456789", "019", "12"]))
    k = rng.randint(1, len(num))
    assert mod.Solution().removeKdigits(num, k) == brute(num, k), (num, k)

tests = [
    case("s1", False, "4352", 1, "Removing the 4 (the first digit larger than its neighbour) is best."),
    case("s2", False, "10200", 1, "\"0200\" loses its leading zero."),
    case("s3", False, "10", 2, "Nothing remains, so the answer is \"0\"."),
    case("s4", False, "112", 1, "Digits never decrease, so remove from the end."),
    case("h-zero", True, "0", 1),
    case("h-all-same", True, "7777", 2),
    case("h-increasing", True, "123456789", 3),
    case("h-decreasing", True, "987654321", 3),
    case("h-zeros-after-removal", True, "100000", 1),
    case("h-zeros-inside", True, "1020304", 2),
    case("h-largest-trap", True, "1432219", 3, "Removing the three largest digits gives 1221, but 1219 is smaller."),
    case("h-k-equals-n-minus-1", True, "52813", 4),
]
for k_, n in enumerate([10, 100, 1000, 5000]):
    num = number(n); tests.append(case(f"h-rand-{k_}", True, num, rng.randint(1, n)))
big = number(60000)
tests.append(case("h-large-random", True, big, 30000))
tests.append(case("h-large-increasing", True, "".join(sorted(number(40000).replace("0", "1"))), 20000, "Non-decreasing: all removals come from the end."))
tests.append(case("h-large-sawtooth", True, ("9" * 50 + "1") * 900, 25000))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
