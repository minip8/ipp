"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib, sys
from functools import lru_cache
sys.setrecursionlimit(20000)

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


def brute(s, words):
    """Independent check: memoised suffix recursion trying every word."""
    @lru_cache(None)
    def go(i):
        return i == len(s) or any(s.startswith(w, i) and go(i + len(w)) for w in words)
    return go(0)


def case(id, hidden, s, words, explanation=None):
    got = mod.Solution().wordBreak(s, list(words))
    assert got == brute(s, tuple(words)), (s, words)
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "wordBreak", "args": [s, words]}],
         "expected": [got]}
    if explanation: t["explanation"] = explanation
    return t


def rand_word(rng, alpha, lo, hi):
    return "".join(rng.choice(alpha) for _ in range(rng.randint(lo, hi)))


def built(rng, words, pieces):
    return "".join(rng.choice(words) for _ in range(pieces))


rng = random.Random(139)
for _ in range(500):
    words = list({rand_word(rng, "ab", 1, 4) for _ in range(rng.randint(1, 5))})
    s = rand_word(rng, "ab", 1, 14)
    assert mod.Solution().wordBreak(s, list(words)) == brute(s, tuple(words))

a_words = ["a" * k for k in range(1, 11)]
tests = [
    case("s1", False, "icecreamcone", ["ice", "cream", "icecream", "cone"], "ice + cream + cone (or icecream + cone)."),
    case("s2", False, "catsandog", ["cats", "dog", "sand", "and", "cat"], "Both cat/sand and cats/and leave 'og'."),
    case("s3", False, "abab", ["ab"], "A word may be reused."),
    case("h-single-char-yes", True, "z", ["z"]),
    case("h-single-char-no", True, "z", ["y", "zz"]),
    case("h-greedy-longest-trap", True, "abcd", ["abc", "ab", "cd"], "Taking 'abc' first strands 'd'."),
    case("h-greedy-shortest-trap", True, "aaaab", ["a", "aaaab"]),
    case("h-word-longer-than-s", True, "ab", ["abc"]),
    case("h-exponential-fail", True, "a" * 200 + "b", a_words,
         "Every split of the a's works until the final b: plain recursion explores ~2^200 paths."),
    case("h-exponential-fail-long", True, "a" * 999 + "b", a_words + ["ab" + "a" * 18]),
    case("h-exponential-pass", True, "a" * 998 + "ab", a_words + ["ab"]),
    case("h-max-word-len", True, "x" * 20 * 50, ["x" * 20]),
    case("h-max-word-len-off", True, "x" * 999, ["x" * 20, "x" * 18]),
]
for k in range(6):
    alpha = "abc"[: 2 + k % 2]
    words = list({rand_word(rng, alpha, 1, 6) for _ in range(rng.randint(3, 12))})
    s = built(rng, words, rng.randint(3, 30))
    if k % 2:  # perturb one character: usually unbreakable
        i = rng.randrange(len(s)); s = s[:i] + "c" + s[i + 1:] if alpha == "ab" else s[:i] + "d" + s[i + 1:]
    tests.append(case(f"h-rand-{k}", True, s, words))
# Large: 1000 words over a 2-letter alphabet, a 1000-char string.
words = list({rand_word(rng, "ab", 5, 20) for _ in range(1200)})[:1000]
s_yes = ""
while True:
    w = rng.choice(words)
    if len(s_yes) + len(w) > 1000:
        break
    s_yes += w
tests.append(case("h-large-yes", True, s_yes, words))
s_no = s_yes[:-1] + "c"
tests.append(case("h-large-no", True, s_no, words))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
