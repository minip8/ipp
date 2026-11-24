"""Regenerates tests.json deterministically from the Python reference solution.

Every operation sequence is replayed against a brute-force model (a set of words, prefix checks
by scanning) and the two must agree before anything is written.
"""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


class Model:
    def __init__(self):
        self.words = set()

    def insert(self, w):
        self.words.add(w)

    def search(self, w):
        return w in self.words

    def startsWith(self, p):
        return any(w.startswith(p) for w in self.words)


def run(cls, ops):
    obj = cls()
    return [getattr(obj, m)(*a) for m, a in ops]


def case(id, hidden, ops, explanation=None):
    expected = run(mod.Trie, ops)
    assert expected == run(Model, ops), id
    t = {"id": id, "hidden": hidden, "ctorArgs": [],
         "calls": [{"method": m, "args": a} for m, a in ops], "expected": expected}
    if explanation: t["explanation"] = explanation
    return t


I = lambda w: ("insert", [w])
S = lambda w: ("search", [w])
P = lambda w: ("startsWith", [w])


def random_ops(rng, n, alpha, maxlen, insert_ratio=0.35):
    pool = []
    ops = []
    for _ in range(n):
        x = rng.random()
        if pool and rng.random() < 0.5:
            base = rng.choice(pool)
            # a prefix, the word itself, or a small extension of a known word
            k = rng.randint(1, len(base))
            w = base[:k] if rng.random() < 0.6 else base + "".join(rng.choice(alpha) for _ in range(rng.randint(0, 2)))
            w = w[:50] or alpha[0]
        else:
            w = "".join(rng.choice(alpha) for _ in range(rng.randint(1, maxlen)))
        if x < insert_ratio:
            ops.append(I(w)); pool.append(w)
        elif x < insert_ratio + (1 - insert_ratio) / 2:
            ops.append(S(w))
        else:
            ops.append(P(w))
    return ops


rng = random.Random(208)
for _ in range(300):
    ops = random_ops(rng, 40, "abc", 4)
    assert run(mod.Trie, ops) == run(Model, ops)

tests = [
    case("s1", False, [I("card"), S("car"), P("car"), I("car"), S("car"), P("cart"), S("card"), P("card")],
         "\"car\" is only a prefix until it is inserted itself; a word is a prefix of itself."),
    case("s2", False, [S("a"), P("a"), I("a"), S("a"), P("a"), S("aa")]),
    case("h-no-node-creation", True, [S("hello"), P("hello"), I("help"), S("hello"), P("hel"), S("hel"), P("helpx")],
         "Lookups must not create nodes."),
    case("h-duplicate-insert", True, [I("abc"), I("abc"), S("abc"), S("ab"), P("ab"), I("ab"), S("ab")]),
    case("h-branching", True, [I("tea"), I("ten"), I("to"), I("inn"), S("te"), P("te"), S("ten"), S("tent"), P("i"),
                               S("in"), P("inn"), P("inns"), S("to"), P("t")]),
    case("h-long-word", True, [I("z" * 50), S("z" * 49), P("z" * 49), S("z" * 50), P("z" * 50), I("z" * 49), S("z" * 49)]),
    case("h-all-letters", True, [I("abcdefghijklmnopqrstuvwxyz"), P("abcdefghijklm"), S("abcdefghijklmnopqrstuvwxy"),
                                 S("abcdefghijklmnopqrstuvwxyz"), P("b")]),
]
for k, (n, alpha, ml) in enumerate([(60, "ab", 4), (120, "abc", 5), (300, "abcd", 6), (500, "abcdefgh", 8)]):
    tests.append(case(f"h-rand-{k}", True, random_ops(rng, n, alpha, ml)))
tests.append(case("h-prefix-heavy", True, random_ops(rng, 800, "ab", 12, insert_ratio=0.2)))
tests.append(case("h-large", True, random_ops(rng, 3000, "abcdefghijklmnopqrstuvwxyz", 12, insert_ratio=0.5)))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
