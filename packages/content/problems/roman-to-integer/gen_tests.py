"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

TOKENS = [(1000, "M"), (900, "CM"), (500, "D"), (400, "CD"), (100, "C"), (90, "XC"),
          (50, "L"), (40, "XL"), (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I")]
def to_roman(n):
    out = []
    for v, t in TOKENS:
        while n >= v:
            out.append(t); n -= v
    return "".join(out)

for n in range(1, 4000):  # exhaustive cross-check
    assert mod.Solution().romanToInt(to_roman(n)) == n

def case(id, hidden, n, explanation=None):
    s = to_roman(n)
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "romanToInt", "args": [s]}], "expected": [n]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(13)
tests = [
    case("s1", False, 8),
    case("s2", False, 94, "XC (90) + IV (4)"),
    case("s3", False, 2026),
    case("s4", False, 449, "CD (400) + XL (40) + IX (9)"),
]
for i, n in enumerate([1, 3, 4, 9, 14, 40, 90, 400, 900, 1994, 3999, 3888, 444, 999, 1444, 3049]):
    tests.append(case(f"h-fixed-{i}", True, n))
for k, n in enumerate(rng.sample(range(1, 4000), 12)):
    tests.append(case(f"h-rand-{k}", True, n))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
