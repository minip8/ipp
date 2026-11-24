"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def brute(a):
    a = list(a)
    while True:
        for i in range(len(a) - 1):
            if a[i] > 0 and a[i + 1] < 0:
                x, y = a[i], -a[i + 1]
                a[i:i + 2] = [a[i]] if x > y else [a[i + 1]] if y > x else []
                break
        else:
            return a

def case(id, hidden, a, explanation=None):
    exp = mod.Solution().asteroidCollision(list(a))
    if len(a) <= 2000: assert exp == brute(a)
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "asteroidCollision", "args": [a]}], "expected": [exp]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(735)
def rand(n, r):
    return [rng.choice([1, -1]) * rng.randint(1, r) for _ in range(n)]
for _ in range(3000):
    a = rand(rng.randint(2, 9), 4)
    assert mod.Solution().asteroidCollision(a) == brute(a)

tests = [
    case("s1", False, [4, 9, -6]),
    case("s2", False, [7, -7], "Equal sizes: both explode."),
    case("s3", False, [3, 5, -8, 2], "-8 destroys 5, then 3; 2 moves away to the right."),
    case("s4", False, [-2, -1, 1, 2], "Left-movers on the left and right-movers on the right never meet."),
    case("h-left-big-destroys-many", True, [1, 2, 3, 4, 5, -10]),
    case("h-right-big-survives", True, [10, -1, -2, -3, -4]),
    case("h-chain-equal", True, [5, 5, -5, -5]),
    case("h-equal-then-continue", True, [2, 3, -3, -1]),
    case("h-all-right", True, [1, 2, 3]),
    case("h-all-left", True, [-3, -2, -1]),
    case("h-alternating", True, [1, -1, 1, -1, 1, -1]),
    case("h-nested", True, [8, 2, -5, 6, -9, 3]),
]
for k, (n, r) in enumerate([(10, 5), (100, 50), (1000, 1000), (2000, 10)]):
    tests.append(case(f"h-rand-{k}", True, rand(n, r)))
tests.append(case("h-large-sweep", True, list(range(1, 5000)) + [-1000] * 3 + [-5000], "One huge left-mover clears everything."))
tests.append(case("h-large-random", True, rand(10000, 1000)))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
