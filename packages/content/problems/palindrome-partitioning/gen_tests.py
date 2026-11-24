"""Regenerates tests.json deterministically from the Python reference solution.

The reference is checked against brute force (every one of the 2^(n-1) cut patterns, filtered)
before anything is written.
"""
import json, random, importlib.util, pathlib, itertools

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


def brute(s):
    n, out = len(s), []
    for cuts in itertools.product([0, 1], repeat=n - 1):
        pieces, start = [], 0
        for i, c in enumerate(cuts):
            if c:
                pieces.append(s[start:i + 1]); start = i + 1
        pieces.append(s[start:])
        if all(p == p[::-1] for p in pieces):
            out.append(tuple(pieces))
    return sorted(out)


def case(id, hidden, s, explanation=None):
    got = mod.Solution().partition(s)
    assert sorted(map(tuple, got)) == brute(s) and len(set(map(tuple, got))) == len(got), id
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "partition", "args": [s]}],
         "expected": [got]}
    if explanation: t["explanation"] = explanation
    return t


rng = random.Random(131)
for _ in range(300):
    s = "".join(rng.choice("ab") for _ in range(rng.randint(1, 9)))
    assert sorted(map(tuple, mod.Solution().partition(s))) == brute(s)

tests = [
    case("s1", False, "abb"),
    case("s2", False, "z"),
    case("s3", False, "abab", "\"bab\" and \"aba\" are palindromes, but \"abab\" is not."),
    case("h-two-diff", True, "ab"),
    case("h-two-same", True, "aa"),
    case("h-racecar", True, "racecar"),
    case("h-no-long-pal", True, "abcdefghijkl", "Only single letters: exactly one partition."),
    case("h-nested", True, "abacaba"),
    case("h-mixed", True, "aabbaab"),
    case("h-even-blocks", True, "abbaabba"),
]
for k in range(8):
    alpha = "ab" if k % 2 == 0 else "abc"
    tests.append(case(f"h-rand-{k}", True, "".join(rng.choice(alpha) for _ in range(rng.randint(6, 12)))))
tests.append(case("h-all-same-11", True, "a" * 11))
tests.append(case("h-all-same-12", True, "a" * 12, "Every one of the 2^11 cut patterns is valid."))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
