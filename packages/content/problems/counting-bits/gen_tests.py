"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def case(id, hidden, n, explanation=None):
    exp = [bin(i).count("1") for i in range(n + 1)]
    assert mod.Solution().countBits(n) == exp
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "countBits", "args": [n]}], "expected": [exp]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(338)
tests = [
    case("s1", False, 2),
    case("s2", False, 6, "5 = 0b101 has two ones; 6 = 0b110 has two ones."),
    case("s3", False, 0, "Only the number 0."),
    case("h-one", True, 1),
    case("h-pow2", True, 16),
    case("h-pow2-minus1", True, 31),
    case("h-carry", True, 64),
]
for k in range(4):
    tests.append(case(f"h-rand-{k}", True, rng.randint(100, 5000)))
tests.append(case("h-large", True, 65535))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
