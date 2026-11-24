"""Regenerates tests.json deterministically from the Python reference solution.

Every sequence is replayed against a brute-force model (linear scan of all versions).
"""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


class Model:
    def __init__(self): self.v = []
    def set(self, k, val, t): self.v.append((k, val, t))
    def get(self, k, t):
        best, bt = "", -1
        for kk, val, tt in self.v:
            if kk == k and tt <= t and tt > bt: best, bt = val, tt
        return best


def run(cls, ops):
    obj = cls()
    return [getattr(obj, m)(*a) for m, a in ops]


def case(id, hidden, ops, explanation=None):
    expected = run(mod.TimeMap, ops)
    assert expected == run(Model, ops), id
    t = {"id": id, "hidden": hidden, "ctorArgs": [],
         "calls": [{"method": m, "args": a} for m, a in ops], "expected": expected}
    if explanation: t["explanation"] = explanation
    return t


def random_ops(rng, n, keys, max_gap, set_p=0.4):
    ops, now = [], 0
    for _ in range(n):
        k = rng.choice(keys)
        if rng.random() < set_p:
            now += rng.randint(1, max_gap)
            ops.append(("set", [k, "v" + str(rng.randint(0, 10**6)), now]))
        else:
            # queries before, at and after recent versions, including exact hits
            t = rng.choice([now, max(1, now - rng.randint(0, 10 * max_gap)), now + rng.randint(0, 5), rng.randint(1, now + 1)])
            ops.append(("get", [k, t]))
    return ops


S = lambda k, v, t: ("set", [k, v, t])
G = lambda k, t: ("get", [k, t])
rng = random.Random(981)

for _ in range(300):
    ops = random_ops(rng, 40, ["a", "b", "c"], 3)
    assert run(mod.TimeMap, ops) == run(Model, ops)

tests = [
    case("s1", False, [S("price", "100", 5), S("price", "105", 9), G("price", 4), G("price", 5), G("price", 8),
                       G("price", 9), G("price", 50), G("volume", 9)],
         "A version set exactly at the query time counts; before the first version the answer is empty."),
    case("s2", False, [S("a", "x", 1), S("b", "y", 2), S("a", "z", 3), G("a", 2), G("b", 2), G("b", 1), G("a", 3)],
         "Versions of different keys are independent."),
    case("h-exact-boundaries", True,
         [S("k", f"v{t}", t) for t in (10, 20, 30, 40)] + [G("k", t) for t in (9, 10, 11, 19, 20, 21, 29, 30, 31, 39, 40, 41, 10**7)]),
    case("h-empty-store", True, [G("a", 1), G("a", 10**7)]),
    case("h-same-value-repeated", True, [S("a", "same", 1), S("a", "same", 2), G("a", 1), G("a", 2), S("a", "diff", 3), G("a", 2), G("a", 3)]),
    case("h-key-prefixes", True, [S("ab", "1", 1), S("a", "2", 2), S("abc", "3", 3), G("a", 3), G("ab", 3), G("abc", 2), G("abcd", 3)]),
    case("h-first-version-late", True, [S("a", "x", 10**7 - 5), G("a", 1), G("a", 10**7 - 6), G("a", 10**7)]),
]
for k, (n, nk, gap) in enumerate([(40, 2, 2), (100, 3, 5), (300, 10, 10), (600, 30, 100)]):
    keys = ["k" + str(i) for i in range(nk)]
    tests.append(case(f"h-rand-{k}", True, random_ops(rng, n, keys, gap)))
# One key with many versions, then many gets: linear scan per get is O(versions).
many = []
for i in range(1, 1501):
    many.append(S("hot", f"v{i}", i * 3))
many += [G("hot", rng.randint(1, 4600)) for _ in range(1300)]
tests.append(case("h-many-versions", True, many, "1500 versions of one key, then 1300 random queries."))
tests.append(case("h-large", True, random_ops(rng, 2200, ["k" + str(i) for i in range(50)], 1000, set_p=0.5)))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
