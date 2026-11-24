"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def brute(n):
    seen = set()
    while n != 1 and n not in seen:
        seen.add(n); n = sum(int(d) ** 2 for d in str(n))
    return n == 1

for n in range(1, 5000):
    assert mod.Solution().isHappy(n) == brute(n), n

def case(id, hidden, n, explanation=None):
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "isHappy", "args": [n]}], "expected": [brute(n)]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(202)
tests = [
    case("s1", False, 7, "7 -> 49 -> 97 -> 130 -> 10 -> 1"),
    case("s2", False, 4, "Enters the cycle 4 -> 16 -> 37 -> 58 -> 89 -> 145 -> 42 -> 20 -> 4."),
    case("s3", False, 1),
]
for i, n in enumerate([2, 10, 19, 100, 116, 145, 1111111, 2147483647, 1000000000, 1999999999, 3, 13]):
    tests.append(case(f"h-fixed-{i}", True, n))
happy = [n for n in (rng.randint(1, 2**31 - 1) for _ in range(400)) if brute(n)][:6]
sad = [n for n in (rng.randint(1, 2**31 - 1) for _ in range(400)) if not brute(n)][:6]
for k, n in enumerate(happy + sad):
    tests.append(case(f"h-rand-{k}", True, n))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
