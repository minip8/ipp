"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib, string

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def per_letter(s, k):
    """Independent O(26 n): for each letter, longest window with <= k other letters."""
    best = 0
    for L in set(s):
        left = other = 0
        for right, ch in enumerate(s):
            other += ch != L
            while other > k:
                other -= s[left] != L; left += 1
            best = max(best, right - left + 1)
    return best

def brute(s, k):
    best = 0
    for i in range(len(s)):
        cnt = [0] * 26
        for j in range(i, len(s)):
            cnt[ord(s[j]) - 65] += 1
            if j - i + 1 - max(cnt) <= k: best = max(best, j - i + 1)
    return best

def case(id, hidden, s, k, explanation=None):
    exp = mod.Solution().characterReplacement(s, k)
    assert exp == per_letter(s, k)
    if len(s) <= 300: assert exp == brute(s, k)
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "characterReplacement", "args": [s, k]}], "expected": [exp]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(424)
def rand(n, alpha):
    return "".join(rng.choice(alpha) for _ in range(n))
for _ in range(3000):
    s = rand(rng.randint(1, 10), "ABC"); k = rng.randint(0, len(s))
    assert mod.Solution().characterReplacement(s, k) == brute(s, k)

U = string.ascii_uppercase
tests = [
    case("s1", False, "ABAB", 2),
    case("s2", False, "AABABBA", 1, "\"AABA\" -> \"AAAA\" or \"BABB\" -> \"BBBB\"."),
    case("s3", False, "XYZ", 0),
    case("h-single", True, "Q", 0),
    case("h-k-equals-n", True, "ABCDE", 5),
    case("h-k-zero-run", True, "AABBBBCC", 0),
    case("h-all-same", True, "ZZZZZZ", 2),
    case("h-best-letter-not-first", True, "ABBBCBBBA", 1),
    case("h-ends", True, "BAAAAB", 2),
]
for k_, (n, a, k) in enumerate([(20, "AB", 3), (300, "ABC", 10), (300, U, 5), (3000, "ABCD", 200)]):
    tests.append(case(f"h-rand-{k_}", True, rand(n, a), k))
tests.append(case("h-large", True, rand(100000, U), 1000))
tests.append(case("h-large-binary", True, rand(100000, "AB"), 50))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
