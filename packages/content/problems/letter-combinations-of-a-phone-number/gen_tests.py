"""Regenerates tests.json deterministically from the Python reference solution.

The reference is checked against itertools.product before anything is written.
"""
import json, random, importlib.util, pathlib, itertools

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

KEYS = {"2": "abc", "3": "def", "4": "ghi", "5": "jkl", "6": "mno", "7": "pqrs", "8": "tuv", "9": "wxyz"}


def brute(digits):
    if not digits:
        return []
    return sorted("".join(p) for p in itertools.product(*(KEYS[d] for d in digits)))


def case(id, hidden, digits, explanation=None):
    got = mod.Solution().letterCombinations(digits)
    assert sorted(got) == brute(digits) and len(set(got)) == len(got), id
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "letterCombinations", "args": [digits]}],
         "expected": [got]}
    if explanation: t["explanation"] = explanation
    return t


rng = random.Random(17)
rd = lambda n: "".join(rng.choice("23456789") for _ in range(n))
for _ in range(200):
    d = rd(rng.randint(0, 4))
    assert sorted(mod.Solution().letterCombinations(d)) == brute(d)

tests = [
    case("s1", False, "29", "3 letters for 2 times 4 letters for 9 gives 12 strings."),
    case("s2", False, "7"),
    case("s3", False, "", "No digits means no combinations at all."),
    case("h-single-2", True, "2"),
    case("h-single-9", True, "9"),
    case("h-repeat", True, "33"),
    case("h-four-letter-keys", True, "797"),
    case("h-all-keys", True, "234"),
]
for k, n in enumerate([3, 4, 5]):
    tests.append(case(f"h-rand-{k}", True, rd(n)))
tests.append(case("h-six-digits", True, "234568"))
tests.append(case("h-worst-6", True, "797979"))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
