"""Regenerates tests.json deterministically from the Python reference solution.

Every operation sequence is replayed against a brute-force model (list of words, character-by-
character matching) and the two must agree before anything is written.
"""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


class Model:
    def __init__(self):
        self.words = []

    def addWord(self, w):
        self.words.append(w)

    def search(self, p):
        return any(len(w) == len(p) and all(a == "." or a == b for a, b in zip(p, w)) for w in self.words)


def run(cls, ops):
    obj = cls()
    return [getattr(obj, m)(*a) for m, a in ops]


def case(id, hidden, ops, explanation=None):
    expected = run(mod.WordDictionary, ops)
    assert expected == run(Model, ops), id
    for m, a in ops:
        assert 1 <= len(a[0]) <= 25 and (m == "search" or "." not in a[0]) and a[0].count(".") <= 3
    t = {"id": id, "hidden": hidden, "ctorArgs": [],
         "calls": [{"method": m, "args": a} for m, a in ops], "expected": expected}
    if explanation: t["explanation"] = explanation
    return t


A = lambda w: ("addWord", [w])
S = lambda p: ("search", [p])


def mask(rng, w, dots):
    w = list(w)
    for i in rng.sample(range(len(w)), min(dots, len(w))):
        w[i] = "."
    return "".join(w)


def random_ops(rng, n, alpha, minlen, maxlen, add_ratio=0.4):
    pool, ops = [], []
    for _ in range(n):
        if rng.random() < add_ratio or not pool:
            w = "".join(rng.choice(alpha) for _ in range(rng.randint(minlen, maxlen)))
            pool.append(w); ops.append(A(w))
        else:
            if rng.random() < 0.6:
                base = rng.choice(pool)
                if rng.random() < 0.4:  # perturb one letter so it may not match
                    i = rng.randrange(len(base))
                    base = base[:i] + rng.choice(alpha) + base[i + 1:]
            else:
                base = "".join(rng.choice(alpha) for _ in range(rng.randint(minlen, maxlen)))
            ops.append(S(mask(rng, base, rng.randint(0, 3))))
    return ops


rng = random.Random(211)
for _ in range(300):
    ops = random_ops(rng, 40, "ab", 1, 4)
    assert run(mod.WordDictionary, ops) == run(Model, ops)

tests = [
    case("s1", False, [A("bad"), A("dad"), A("mad"), S("pad"), S("bad"), S(".ad"), S("b.."), S("b."), S("..."), S("bad.")],
         "'.' matches exactly one letter, and lengths must be equal."),
    case("s2", False, [S("a"), S("."), A("a"), S("."), S(".."), A("ab"), S(".."), S(".b"), S("b.")]),
    case("h-prefix-not-match", True, [A("abcd"), S("abc"), S("ab.."), S("ab."), S("...d"), S("a.c.."), A("abc"), S("ab.")],
         "A pattern matching only a prefix of a word does not count."),
    case("h-dot-backtrack", True, [A("axyz"), A("bxyq"), A("cxzz"), S(".xyq"), S(".xzz"), S(".x.z"), S("..yq"), S("..zw")],
         "The first child tried for '.' fails; the search must try the others."),
    case("h-all-dots", True, [A("hello"), A("world"), S("h...o"), S("...l"), S("w...d"), S("..r.d"), S("...lo"), S("x...o"), S("wor..")]),
    case("h-long", True, [A("a" * 25), A("a" * 24 + "b"), S("a" * 22 + "..b"), S("." * 3 + "a" * 22), S("a" * 22 + "..c"),
                          S("." * 3 + "a" * 21 + "b"), S("a" * 23 + ".")]),
    case("h-duplicates", True, [A("same"), A("same"), S("s.me"), S("sam."), S("same"), S("sames")]),
]
for k, (n, alpha, lo, hi) in enumerate([(60, "ab", 1, 3), (150, "abc", 2, 5), (300, "abcde", 3, 6), (600, "abcdefgh", 3, 8)]):
    tests.append(case(f"h-rand-{k}", True, random_ops(rng, n, alpha, lo, hi)))
tests.append(case("h-dense-short", True, random_ops(rng, 1000, "abcdefghijklmnopqrstuvwxyz", 3, 4, add_ratio=0.6)))
tests.append(case("h-large", True, random_ops(rng, 2500, "abcdefghijklmnopqrstuvwxyz", 4, 12, add_ratio=0.5)))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
