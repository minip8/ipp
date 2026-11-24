"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib, string

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def brute(s):
    best = 0
    for i in range(len(s)):
        seen = set()
        for j in range(i, len(s)):
            if s[j] in seen: break
            seen.add(s[j])
        best = max(best, len(seen))
    return best

def case(id, hidden, s, explanation=None):
    exp = mod.Solution().lengthOfLongestSubstring(s)
    if len(s) <= 3000: assert exp == brute(s)
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "lengthOfLongestSubstring", "args": [s]}], "expected": [exp]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(3)
PRINTABLE = "".join(chr(c) for c in range(32, 127))
for _ in range(3000):
    s = "".join(rng.choice("abcd ") for _ in range(rng.randint(0, 10)))
    assert mod.Solution().lengthOfLongestSubstring(s) == brute(s)

def rand(n, alpha):
    return "".join(rng.choice(alpha) for _ in range(n))

tests = [
    case("s1", False, "pwwkew", "\"wke\" - \"pwke\" is a subsequence, not a substring."),
    case("s2", False, "abba", "When the second 'a' arrives, its previous index is already left of the window."),
    case("s3", False, "dvdf", "\"vdf\": don't reset the whole window on a repeat."),
    case("s4", False, ""),
    case("h-single", True, "x"),
    case("h-all-same", True, "zzzzzz"),
    case("h-spaces", True, "a b c"),
    case("h-all-distinct", True, PRINTABLE, "All 95 printable characters."),
    case("h-tail-best", True, "aab" + "cdefgh"),
    case("h-tmmzuxt", True, "tmmzuxt"),
    case("h-punct", True, "!?!?.,;:"),
]
for k, (n, a) in enumerate([(20, "abc"), (200, string.ascii_lowercase), (2000, PRINTABLE), (3000, "ab ")]):
    tests.append(case(f"h-rand-{k}", True, rand(n, a)))
tests.append(case("h-large-printable", True, rand(60000, PRINTABLE.replace("\\", "").replace('"', ""))))
tests.append(case("h-large-repeat-block", True, (PRINTABLE * 700)[:60000], "Window slides one step at a time for every character."))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
