"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib, string

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def solve(s):
    return mod.Solution().isPalindrome(s)

def brute(s):
    t = [c.lower() for c in s if c in string.ascii_letters + string.digits]
    return t == t[::-1]

def case(id, hidden, s, explanation=None):
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "isPalindrome", "args": [s]}],
         "expected": [solve(s)]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(125)
alpha = "aAbB01 ,.!?:"
for _ in range(5000):
    s = "".join(rng.choice(alpha) for _ in range(rng.randint(1, 10)))
    assert solve(s) == brute(s), s

def noisy_pal(n, punct_rate):
    half = [rng.choice(string.ascii_lowercase + string.digits) for _ in range(n // 2)]
    core = half + ([rng.choice("xyz")] if n % 2 else []) + half[::-1]
    out = []
    for c in core:
        while rng.random() < punct_rate:
            out.append(rng.choice(" ,.;:!?'-_()[]{}\"\\/@#"))
        out.append(c.upper() if c.isalpha() and rng.random() < 0.5 else c)
    return "".join(out)

def break_one(s):
    idx = [i for i, c in enumerate(s) if c.isalnum()]
    i = idx[len(idx) // 3]
    return s[:i] + ("q" if s[i].lower() != "q" else "r") + s[i + 1:]

tests = [
    case("s1", False, "Step on no pets!", "Cleaned: \"steponnopets\"."),
    case("s2", False, "Top spot? No: pots.", "Cleaned: \"topspotnopots\" - not symmetric."),
    case("s3", False, "8a,  A8"),
    case("s4", False, " .,!", "No letters or digits: counts as a palindrome."),
    case("h-digit-letter", True, "0P", "Digits are not case-folded."),
    case("h-single", True, "Z"),
    case("h-two-diff", True, "ab"),
    case("h-case", True, "AbBa"),
    case("h-punct-edges", True, "...a..."),
    case("h-punct-mid", True, "a.,.,.,b"),
    case("h-digits", True, "12 3 21"),
    case("h-digits-no", True, "12 3 12"),
    case("h-underscore", True, "a_b_a"),
    case("h-quotes", True, "\"No 'x' in Nixon\""),
    case("h-backslash", True, "\\a\\"),
]
for k, n in enumerate([5, 20, 101, 1000]):
    s = noisy_pal(n, 0.3)
    tests.append(case(f"h-rand-pal-{k}", True, s))
    tests.append(case(f"h-rand-near-{k}", True, break_one(s)))
big = noisy_pal(30000, 0.5)
tests.append(case("h-large-yes", True, big))
tests.append(case("h-large-no", True, big[:len(big) // 2] + "q" + big[len(big) // 2 + 1:] if big[len(big)//2].lower() != "q" else break_one(big)))
tests.append(case("h-large-punct", True, "!" * 50000))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
