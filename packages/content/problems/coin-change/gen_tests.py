"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib
from collections import deque

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


def bfs(coins, amount):
    """Independent check: BFS over totals, one coin per edge."""
    dist = {0: 0}
    q = deque([0])
    while q:
        x = q.popleft()
        if x == amount:
            return dist[x]
        for c in coins:
            y = x + c
            if y <= amount and y not in dist:
                dist[y] = dist[x] + 1
                q.append(y)
    return -1


def case(id, hidden, coins, amount, explanation=None):
    got = mod.Solution().coinChange(list(coins), amount)
    assert got == bfs(coins, amount), (coins, amount)
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "coinChange", "args": [coins, amount]}],
         "expected": [got]}
    if explanation: t["explanation"] = explanation
    return t


rng = random.Random(322)
for _ in range(400):
    coins = rng.sample(range(1, 30), rng.randint(1, 5))
    amount = rng.randint(0, 200)
    assert mod.Solution().coinChange(list(coins), amount) == bfs(coins, amount)

tests = [
    case("s1", False, [1, 5, 6, 9], 11, "5 + 6 uses 2 coins; taking 9 first would need 3."),
    case("s2", False, [4, 6], 7, "Every combination of 4s and 6s is even."),
    case("s3", False, [3], 0, "Zero coins make zero."),
    case("h-single-exact", True, [7], 7),
    case("h-single-impossible", True, [7], 13),
    case("h-ones", True, [1], 10000),
    case("h-greedy-trap", True, [1, 3, 4], 6, "Greedy takes 4+1+1; optimum is 3+3."),
    case("h-greedy-trap-2", True, [25, 10, 1], 30, "Greedy takes 25+1*5; optimum is 10*3."),
    case("h-coin-too-big", True, [100000, 2], 9999),
    case("h-big-coin-only", True, [100000], 10000),
    case("h-unsorted", True, [9, 2, 13, 5], 27),
    case("h-coprime-large", True, [997, 1009], 9998),
    case("h-tiny-unreachable", True, [6, 10, 15], 1),
    case("h-frobenius", True, [6, 10, 15], 29, "29 is the largest amount 6, 10 and 15 cannot make."),
]
for k in range(8):
    coins = rng.sample(range(1, 60 if k < 4 else 400), rng.randint(1, 6) if k < 4 else rng.randint(3, 8))
    tests.append(case(f"h-rand-{k}", True, coins, rng.randint(1, 500 if k < 4 else 10000)))
tests.append(case("h-large-12", True, [1513] + list(range(37, 37 * 12, 37)), 9990))
tests.append(case("h-large-deep", True, [83, 89, 97, 101, 103, 107, 109, 113, 127, 131, 137, 139], 9973,
                  "Many coins and a deep search; plain recursion without memoisation never finishes."))
tests.append(case("h-max-coin-count", True, [2, 9999], 10000, "Using 9999 leaves 1, which cannot be made, so the answer is 5000 twos."))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
