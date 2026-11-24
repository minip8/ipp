"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def solve(prices):
    return mod.Solution().maxProfit(list(prices))

def brute(prices):
    return max([0] + [prices[j] - prices[i] for i in range(len(prices)) for j in range(i + 1, len(prices))])

def case(id, hidden, prices, explanation=None):
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "maxProfit", "args": [prices]}],
         "expected": [solve(prices)]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(121)
for _ in range(2000):
    p = [rng.randint(0, 20) for _ in range(rng.randint(1, 12))]
    assert solve(p) == brute(p), p

tests = [
    case("s1", False, [8, 3, 6, 1, 5, 4], "Buy at 1, sell at 5."),
    case("s2", False, [9, 7, 4, 2], "Prices only fall, so don't trade."),
    case("s3", False, [2, 9, 1, 3], "The overall minimum (1) comes after the overall maximum (9); the best trade is 2 -> 9."),
    case("h-single", True, [5]),
    case("h-two-up", True, [1, 2]),
    case("h-two-down", True, [2, 1]),
    case("h-flat", True, [7, 7, 7, 7]),
    case("h-zeros", True, [0, 0, 10000]),
    case("h-max-before-min", True, [10, 10000, 0, 5]),
    case("h-late-low", True, [3, 8, 1, 7]),
    case("h-increasing", True, list(range(0, 50))),
]
for k, n in enumerate([10, 50, 300, 2000]):
    tests.append(case(f"h-rand-{k}", True, [rng.randint(0, 10000) for _ in range(n)]))
big = list(range(10000, 0, -1)) + [rng.randint(0, 10000) for _ in range(10000)]
tests.append(case("h-large", True, big))
walk, x = [], 5000
for _ in range(20000):
    x = min(10000, max(0, x + rng.randint(-3, 3))); walk.append(x)
tests.append(case("h-large-walk", True, walk))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
