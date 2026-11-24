"""Regenerates tests.json deterministically from the Python reference solution.

Every sequence is replayed against a brute-force model (list of all completed journeys, averaged
with exact fractions) and both must agree to 1e-9.
"""
import json, random, importlib.util, pathlib
from fractions import Fraction

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


class Model:
    def __init__(self): self.open, self.done = {}, []
    def checkIn(self, i, s, t): self.open[i] = (s, t)
    def checkOut(self, i, s, t):
        a, t0 = self.open.pop(i); self.done.append((a, s, t - t0))
    def getAverageTime(self, a, b):
        d = [x for s, e, x in self.done if s == a and e == b]
        return float(Fraction(sum(d), len(d)))


def run(cls, ops):
    obj = cls()
    return [getattr(obj, m)(*a) for m, a in ops]


def same(a, b):
    return all((x is None and y is None) or abs(x - y) <= 1e-9 * max(1, abs(y)) for x, y in zip(a, b))


def case(id, hidden, ops, explanation=None):
    expected = run(mod.UndergroundSystem, ops)
    assert same(expected, run(Model, ops)), id
    t = {"id": id, "hidden": hidden, "ctorArgs": [],
         "calls": [{"method": m, "args": a} for m, a in ops], "expected": expected}
    if explanation: t["explanation"] = explanation
    return t


def random_ops(rng, n, cards, stations, max_dt):
    """Valid sequences only: each card alternates in/out, out time > in time, queries hit known routes."""
    ops, now, open_, routes = [], 1, {}, []
    while len(ops) < n:
        now += rng.randint(0, 3)
        r = rng.random()
        if r < 0.2 and routes:
            ops.append(("getAverageTime", list(rng.choice(routes))))
            continue
        c = rng.choice(cards)
        if c in open_:
            s0, t0 = open_[c]
            if now <= t0: continue
            end = rng.choice(stations)
            t = min(now + rng.randint(0, max_dt), 10**6)
            if t <= t0: continue
            # keep the global sequence consistent: check-out time is just a parameter, not a clock
            ops.append(("checkOut", [c, end, t])); del open_[c]
            if (s0, end) not in routes: routes.append((s0, end))
        else:
            s = rng.choice(stations)
            open_[c] = (s, now)
            ops.append(("checkIn", [c, s, now]))
    return ops


I = lambda i, s, t: ("checkIn", [i, s, t])
O = lambda i, s, t: ("checkOut", [i, s, t])
A = lambda a, b: ("getAverageTime", [a, b])
rng = random.Random(1396)

for _ in range(300):
    ops = random_ops(rng, 40, [1, 2, 3], ["A", "B", "C"], 10)
    assert same(run(mod.UndergroundSystem, ops), run(Model, ops))

tests = [
    case("s1", False, [I(1, "Bank", 3), I(2, "Bank", 4), O(1, "Oval", 15), A("Bank", "Oval"), O(2, "Oval", 21),
                       A("Bank", "Oval"), I(1, "Oval", 30), O(1, "Bank", 31), A("Bank", "Oval"), A("Oval", "Bank")],
         "(12 + 17) / 2 = 14.5; the Oval -> Bank trip is a separate route."),
    case("s2", False, [I(7, "X", 1), O(7, "X", 4), I(7, "X", 10), O(7, "X", 11), A("X", "X")],
         "A card can travel repeatedly, and a round trip to the same station is a route too: (3 + 1) / 2 = 2."),
    case("h-key-collision", True, [I(1, "ab", 1), O(1, "c", 3), I(2, "a", 1), O(2, "bc", 101), A("ab", "c"), A("a", "bc")],
         "Concatenating names without a separator merges ab+c with a+bc."),
    case("h-non-integer-average", True, [I(1, "A", 1), O(1, "B", 2), I(2, "A", 1), O(2, "B", 2), I(3, "A", 1), O(3, "B", 3), A("A", "B")],
         "(1 + 1 + 2) / 3 = 1.333...; integer division would give 1."),
    case("h-large-sums", True, [x for i in range(1, 41) for x in (I(i, "Far", 1), O(i, "Away", 10**6))] + [A("Far", "Away")],
         "Durations near 10^6 summed over many trips."),
    case("h-interleaved", True, [I(1, "A", 1), I(2, "B", 2), I(3, "A", 3), O(2, "A", 10), O(1, "B", 11), O(3, "B", 13),
                                 A("A", "B"), A("B", "A"), I(2, "A", 20), O(2, "B", 40), A("A", "B")]),
]
names = ["Bank", "Oval", "Angel", "Euston", "Kew", "Bow", "Leyton", "Hyde", "Morden", "Epping"]
for k, (n, nc, ns, dt) in enumerate([(50, 3, 3, 10), (150, 10, 4, 50), (400, 30, 6, 200), (800, 100, 10, 1000)]):
    tests.append(case(f"h-rand-{k}", True, random_ops(rng, n, list(range(1, nc + 1)), names[:ns], dt)))
tests.append(case("h-large", True, random_ops(rng, 3000, list(range(1, 500)), names + [n + "2" for n in names], 5000)))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
