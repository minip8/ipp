"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib, string, re

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def check(words, w, lines):
    """Independent validation of every rule."""
    assert all(len(l) == w for l in lines)
    got = [x for l in lines for x in l.split()]
    assert got == words
    for idx, l in enumerate(lines):
        ws = l.split()
        last = idx == len(lines) - 1
        if last or len(ws) == 1:
            assert l == " ".join(ws).ljust(w)
        else:
            runs = [len(g) for g in re.findall(" +", l)]
            assert not l.startswith(" ") and not l.endswith(" ") and len(runs) == len(ws) - 1
            assert max(runs) - min(runs) <= 1 and runs == sorted(runs, reverse=True)
        if not last:  # greedy: the next line's first word wouldn't fit
            nxt = lines[idx + 1].split()[0]
            assert len(" ".join(ws)) + 1 + len(nxt) > w

def case(id, hidden, words, w, explanation=None):
    exp = mod.Solution().fullJustify(list(words), w)
    check(words, w, exp)
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "fullJustify", "args": [words, w]}], "expected": [exp]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(68)
CH = string.ascii_letters + string.digits + ".,;:!?-'()"
def words_(n, maxlen):
    return ["".join(rng.choice(CH) for _ in range(rng.randint(1, maxlen))) for _ in range(n)]
for _ in range(2000):
    w = rng.randint(1, 12)
    ws = words_(rng.randint(1, 10), w)
    check(ws, w, mod.Solution().fullJustify(ws, w))

tests = [
    case("s1", False, ["We", "fix", "bugs", "fast", "and", "ship", "often."], 14),
    case("s2", False, ["Practice", "makes", "permanent."], 10, "A single word on a line is left-justified."),
    case("s3", False, ["a", "b", "c"], 5, "The first line is also the last line."),
    case("h-one-word-exact", True, ["exact"], 5),
    case("h-one-char-width", True, ["a", "b", "c"], 1),
    case("h-exact-fit", True, ["ab", "cd", "ef", "gh"], 5, "Each line \"ab cd\" fills the width exactly."),
    case("h-uneven-many-gaps", True, ["a", "b", "c", "d", "e", "longword"], 12, "4 gaps sharing 7 spaces: 2, 2, 2, 1."),
    case("h-last-line-multi", True, ["x", "y", "z", "lastline", "is", "here"], 10),
    case("h-width-100", True, words_(60, 15), 100),
    case("h-long-then-short", True, ["supercalifragilistic", "a", "b"], 20),
    case("h-punctuation", True, ["Hello,", "world!", "(test)", "it's", "fine;", "ok?"], 13),
]
for k, (n, maxlen, w) in enumerate([(10, 5, 16), (40, 8, 20), (200, 12, 30), (500, 3, 7)]):
    tests.append(case(f"h-rand-{k}", True, words_(n, min(maxlen, w)), w))
tests.append(case("h-large", True, words_(2000, 10), 80))
tests.append(case("h-large-narrow", True, words_(2000, 4), 9))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
