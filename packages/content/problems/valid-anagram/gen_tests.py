"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def case(id, hidden, s, t, explanation=None):
    exp = sorted(s) == sorted(t)
    assert mod.Solution().isAnagram(s, t) == exp
    tc = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "isAnagram", "args": [s, t]}], "expected": [exp]}
    if explanation: tc["explanation"] = explanation
    return tc

rng = random.Random(242)
def rand(n, a="abcdefghijklmnopqrstuvwxyz"):
    return "".join(rng.choice(a) for _ in range(n))
def shuf(s):
    l = list(s); rng.shuffle(l); return "".join(l)
def tweak(s):
    i = rng.randrange(len(s)); c = "a" if s[i] != "a" else "b"
    return s[:i] + c + s[i + 1:]

tests = [
    case("s1", False, "listen", "silent"),
    case("s2", False, "rat", "tar"),
    case("s3", False, "aab", "abb", "Same set of letters, different counts."),
    case("s4", False, "ab", "abc"),
    case("h-single-same", True, "z", "z"),
    case("h-single-diff", True, "z", "y"),
    case("h-identical", True, "anagram", "anagram"),
    case("h-subset-longer", True, "abc", "abcc"),
    case("h-same-length-diff", True, "abcd", "abce"),
]
for k, n in enumerate([10, 100, 1000]):
    s = rand(n, "abc")
    tests.append(case(f"h-rand-yes-{k}", True, s, shuf(s)))
    tests.append(case(f"h-rand-no-{k}", True, s, shuf(tweak(s))))
big = rand(50000)
tests.append(case("h-large-yes", True, big, shuf(big)))
tests.append(case("h-large-no", True, big, shuf(tweak(big))))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
