"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def canon(groups):
    return sorted(sorted(g) for g in groups)

def brute(words):
    groups = []
    for w in words:
        for g in groups:
            if sorted(g[0]) == sorted(w):
                g.append(w); break
        else:
            groups.append([w])
    return groups

def case(id, hidden, words, explanation=None):
    exp = mod.Solution().groupAnagrams(list(words))
    assert canon(exp) == canon(brute(words)) if len(words) <= 3000 else True
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "groupAnagrams", "args": [words]}], "expected": [exp]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(49)
def word(n, alpha):
    return "".join(rng.choice(alpha) for _ in range(n))
def shuffled(w):
    l = list(w); rng.shuffle(l); return "".join(l)
for _ in range(1000):
    ws = [word(rng.randint(0, 3), "ab") for _ in range(rng.randint(1, 6))]
    assert canon(mod.Solution().groupAnagrams(ws)) == canon(brute(ws))

def gen(groups, size, length, alpha="abcdefghijklmnopqrstuvwxyz"):
    out = []
    for _ in range(groups):
        base = word(rng.randint(0, length), alpha)
        out += [shuffled(base) for _ in range(rng.randint(1, size))]
    rng.shuffle(out)
    return out

tests = [
    case("s1", False, ["listen", "stone", "silent", "notes", "pots", "enlist"]),
    case("s2", False, ["", "b", ""], "Duplicates (including empty strings) are kept."),
    case("s3", False, ["abc"]),
    case("h-same-letters-diff-counts", True, ["aab", "abb", "bab", "aba"], "Same letter set, different multisets."),
    case("h-count-collision", True, ["a" + "b" * 11, "a" * 11 + "b", "b" * 11 + "a"], "Counts [1, 11] vs [11, 1]: keys need separators."),
    case("h-all-same", True, ["abc", "bca", "cab", "abc"]),
    case("h-all-distinct", True, ["a", "b", "c", "ab", "abc"]),
    case("h-single-letters", True, ["z", "z", "y"]),
]
for k, (g, s, l) in enumerate([(5, 3, 5), (30, 5, 8), (200, 4, 12), (500, 10, 6)]):
    tests.append(case(f"h-rand-{k}", True, gen(g, s, l)))
tests.append(case("h-small-alpha", True, gen(400, 6, 10, "ab")))
tests.append(case("h-large", True, gen(2500, 4, 15)))
tests.append(case("h-large-long", True, gen(60, 5, 100, "abc")))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
