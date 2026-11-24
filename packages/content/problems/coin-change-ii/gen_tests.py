"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib, sys
from functools import lru_cache

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
sys.setrecursionlimit(10000)


def brute(amount, coins):
    """Independent check: choose a count for each denomination in turn."""
    @lru_cache(None)
    def go(i, rem):
        if i == len(coins):
            return 1 if rem == 0 else 0
        return sum(go(i + 1, rem - k * coins[i]) for k in range(rem // coins[i] + 1))
    return go(0, amount)


def max_intermediate(amount, coins):
    dp, m = [1] + [0] * amount, 1
    for c in coins:
        for a in range(c, amount + 1):
            dp[a] += dp[a - c]
            m = max(m, dp[a])
    return m


def case(id, hidden, amount, coins, explanation=None, check=True):
    got = mod.Solution().change(amount, list(coins))
    if check:
        assert got == brute(amount, tuple(coins)), (amount, coins)
    assert max_intermediate(amount, coins) <= 10**15, id
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "change", "args": [amount, coins]}],
         "expected": [got]}
    if explanation: t["explanation"] = explanation
    return t


rng = random.Random(518)
for _ in range(300):
    coins = rng.sample(range(1, 25), rng.randint(1, 5))
    amount = rng.randint(0, 60)
    assert mod.Solution().change(amount, list(coins)) == brute(amount, tuple(coins))

tests = [
    case("s1", False, 5, [1, 2, 5], "5, 2+2+1, 2+1+1+1 and 1+1+1+1+1."),
    case("s2", False, 3, [2], "No combination of 2s makes an odd amount."),
    case("s3", False, 0, [7], "Using no coins is the one way to make 0."),
    case("h-order-trap", True, 3, [1, 2], "2 combinations; counting orders would give 3."),
    case("h-order-trap-2", True, 10, [2, 5, 3, 6]),
    case("h-coin-too-big", True, 4, [5, 10]),
    case("h-single-coin", True, 4999, [1]),
    case("h-uk-coins", True, 500, [1, 2, 5, 10, 20, 50, 100, 200]),
]
for k in range(8):
    coins = rng.sample(range(1, 40 if k < 4 else 80), rng.randint(2, 8) if k < 4 else rng.randint(4, 10))
    tests.append(case(f"h-rand-{k}", True, rng.randint(1, 120) if k < 4 else rng.randint(200, 400), coins, check=k < 6))
tests.append(case("h-uk-coins-large", True, 5000, [200, 100, 50, 20, 10, 5, 2, 1],
                  "About 10^13 combinations: needs 64-bit arithmetic.", check=False))
tests.append(case("h-sparse", True, 5000, [3, 7, 11, 13], check=False))
r2 = random.Random(5)
for k, lo in enumerate([50, 100, 300]):
    tests.append(case(f"h-large-{k}", True, 5000, r2.sample(range(lo, 5001), 300), check=False))
tests.append(case("h-large-odd-miss", True, 4999, list(range(400, 1000, 2)), "Only even coins: zero ways, after a lot of work.", check=False))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
