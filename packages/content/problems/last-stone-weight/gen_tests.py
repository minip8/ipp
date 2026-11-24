"""Regenerates tests.json deterministically from the Python reference solution.

A sort-every-round brute force is checked against the reference on small random inputs first.
"""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


def brute(stones):
    s = list(stones)
    while len(s) > 1:
        s.sort()
        y, x = s.pop(), s.pop()
        if y != x:
            s.append(y - x)
    return s[0] if s else 0


def solve(stones):
    return mod.Solution().lastStoneWeight(list(stones))


def case(id, hidden, stones, explanation=None):
    t = {"id": id, "hidden": hidden, "ctorArgs": [],
         "calls": [{"method": "lastStoneWeight", "args": [stones]}], "expected": [solve(stones)]}
    if explanation: t["explanation"] = explanation
    return t


rng = random.Random(1046)
for _ in range(1000):
    st = [rng.randint(1, rng.choice([3, 10, 1000])) for _ in range(rng.randint(1, 12))]
    assert solve(st) == brute(st)

tests = [
    case("s1", False, [3, 8, 4, 1, 5], "8,5 -> 3; 4,3 -> 1; 3,1 -> 2; 2,1 -> 1."),
    case("s2", False, [6, 6], "Equal stones destroy each other."),
    case("s3", False, [9]),
    case("h-all-equal-even", True, [7] * 10),
    case("h-all-equal-odd", True, [7] * 11),
    case("h-pairs", True, [1, 1, 2, 2, 3, 3, 1000, 1000]),
    case("h-min-heap-trap", True, [1, 2, 3, 10, 30],
         "Smashing the lightest stones first gives a different answer."),
    case("h-one-big", True, [1000, 1, 1, 1, 1, 1]),
    case("h-sorted", True, list(range(1, 21))),
]
for k, (n, w) in enumerate([(5, 10), (12, 50), (40, 1000), (200, 1000), (1000, 1000), (3000, 7)]):
    tests.append(case(f"h-rand-{k}", True, [rng.randint(1, w) for _ in range(n)]))
tests.append(case("h-large", True, [rng.randint(1, 1000) for _ in range(20000)]))
tests.append(case("h-large-small-weights", True, [rng.randint(1, 3) for _ in range(20000)]))
tests.append(case("h-large-one-heavy", True, [1000] + [1] * 19999))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
