"""Regenerates tests.json deterministically from the Python reference solution.

Every sequence is replayed against a brute-force model (dict of prices, scanned per query).
"""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


class Model:
    def __init__(self): self.p = {}
    def update(self, t, v): self.p[t] = v
    def current(self): return self.p[max(self.p)]
    def maximum(self): return max(self.p.values())
    def minimum(self): return min(self.p.values())


def run(cls, ops):
    obj = cls()
    return [getattr(obj, m)(*a) for m, a in ops]


def case(id, hidden, ops, explanation=None):
    expected = run(mod.StockPrice, ops)
    assert expected == run(Model, ops), id
    t = {"id": id, "hidden": hidden, "ctorArgs": [],
         "calls": [{"method": m, "args": a} for m, a in ops], "expected": expected}
    if explanation: t["explanation"] = explanation
    return t


def random_ops(rng, n, ts_range, price_range, update_p=0.5):
    ops, seen = [], False
    for _ in range(n):
        if not seen or rng.random() < update_p:
            ops.append(("update", [rng.randint(1, ts_range), rng.randint(1, price_range)])); seen = True
        else:
            ops.append((rng.choice(["current", "maximum", "minimum"]), []))
    return ops


U = lambda t, p: ("update", [t, p])
C, MX, MN = ("current", []), ("maximum", []), ("minimum", [])
rng = random.Random(2034)

for _ in range(300):
    ops = random_ops(rng, 50, rng.choice([3, 8, 30]), rng.choice([3, 10, 100]))
    assert run(mod.StockPrice, ops) == run(Model, ops)

tests = [
    case("s1", False, [U(1, 10), U(2, 5), C, MX, U(1, 3), MX, U(4, 2), MN, U(3, 8), C, MX],
         "The correction at timestamp 1 removes the price 10; the late record for timestamp 3 does not change current()."),
    case("s2", False, [U(7, 100), C, MX, MN, U(7, 50), C, MX, MN],
         "With a single timestamp, a correction changes every answer."),
    case("h-duplicate-prices", True, [U(1, 5), U(2, 5), U(3, 1), U(1, 2), MX, MN, U(2, 1), MX, MN, C],
         "Two timestamps share price 5; correcting one must leave the other."),
    case("h-out-of-order", True, [U(100, 1), U(50, 2), U(75, 3), C, U(10, 9), C, MX, U(100, 4), C, U(101, 6), C]),
    case("h-correct-same-price", True, [U(1, 4), U(1, 4), U(1, 4), MX, MN, U(2, 9), U(1, 10), MX, MN, U(1, 4), MX, MN]),
    case("h-flip-flop", True, [x for i in range(40) for x in (U(1, 1 + i % 3), U(2, 3 - i % 3), MX, MN, C)]),
    case("h-extremes", True, [U(10**9, 10**9), U(1, 1), C, MX, MN, U(10**9, 1), MX, C]),
]
for k, (n, tr, pr) in enumerate([(50, 5, 5), (150, 20, 50), (400, 100, 10**9), (800, 30, 5)]):
    tests.append(case(f"h-rand-{k}", True, random_ops(rng, n, tr, pr)))
tests.append(case("h-correction-heavy", True, random_ops(rng, 1500, 50, 10**6, update_p=0.6)))
# Many distinct timestamps then many queries: scanning all prices per query is O(n) each.
big = [U(rng.randint(1, 10**9), rng.randint(1, 10**9)) for _ in range(1500)] + random_ops(rng, 1500, 10**9, 10**9, update_p=0.3)
tests.append(case("h-large", True, big))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
