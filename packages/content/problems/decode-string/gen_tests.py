"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib, re

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def brute(s):
    pat = re.compile(r"(\d+)\[([a-z]*)\]")
    while "[" in s:
        s = pat.sub(lambda m: m.group(2) * int(m.group(1)), s)
    return s

def case(id, hidden, s, explanation=None):
    exp = mod.Solution().decodeString(s)
    assert exp == brute(s) and len(exp) <= 10**5 and len(s) <= 3000
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "decodeString", "args": [s]}], "expected": [exp]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(394)
def gen(depth, width, maxk):
    parts = []
    for _ in range(rng.randint(1, width)):
        if depth and rng.random() < 0.5:
            parts.append(f"{rng.randint(1, maxk)}[{gen(depth - 1, width, maxk)}]")
        else:
            parts.append("".join(rng.choice("abcxyz") for _ in range(rng.randint(0, 3))))
    return "".join(parts)
def decoded_len(s):
    return len(brute(s))
for _ in range(2000):
    s = gen(3, 3, 4)
    assert mod.Solution().decodeString(s) == brute(s)

def bounded(depth, width, maxk, limit, min_len=0):
    while True:
        s = gen(depth, width, maxk)
        if len(s) <= 3000 and min_len <= decoded_len(s) <= limit:
            return s

tests = [
    case("s1", False, "2[ab]c"),
    case("s2", False, "x3[y2[z]]", "Inner group first: y2[z] = yzz, repeated 3 times after the x."),
    case("s3", False, "10[a]", "Counts can have more than one digit."),
    case("s4", False, "ab2[]c", "An empty body contributes nothing."),
    case("h-plain", True, "abc"),
    case("h-one", True, "1[q]"),
    case("h-adjacent-groups", True, "2[a]3[bc]"),
    case("h-text-around", True, "pre2[mid]post"),
    case("h-deep", True, "2[" * 10 + "a" + "]" * 10, "2^10 = 1024 a's."),
    case("h-multi-digit-nested", True, "12[ab3[c]]"),
    case("h-max-k", True, "300[ab]"),
    case("h-empty-nested", True, "3[2[]x]"),
]
for k in range(5):
    tests.append(case(f"h-rand-{k}", True, bounded(3 + k % 3, 3, 12, 3000)))
tests.append(case("h-large-output", True, "300[" + "100[abc]" + "]", "Output is 90000 characters."))
tests.append(case("h-large-nested", True, bounded(6, 4, 9, 100000, 20000)))
tests.append(case("h-large-many-groups", True, "".join(f"{rng.randint(1, 300)}[{rng.choice('xyz')}]" for _ in range(400))[:2990].rsplit("]", 1)[0] + "]"))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
