"""Regenerates tests.json deterministically from the Python reference solution.

Every sequence is replayed against a brute-force model (keep every hit, count on each query).
"""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


class Model:
    def __init__(self): self.h = []
    def hit(self, t): self.h.append(t)
    def getHits(self, t): return sum(1 for s in self.h if t - 300 < s <= t)


def run(cls, ops):
    obj = cls()
    return [getattr(obj, m)(*a) for m, a in ops]


def case(id, hidden, ops, explanation=None):
    expected = run(mod.HitCounter, ops)
    assert expected == run(Model, ops), id
    t = {"id": id, "hidden": hidden, "ctorArgs": [],
         "calls": [{"method": m, "args": a} for m, a in ops], "expected": expected}
    if explanation: t["explanation"] = explanation
    return t


def random_ops(rng, n, max_gap, start=1, hit_p=0.6):
    ops, now = [], start
    for _ in range(n):
        now += rng.choice([0, 0, 0, rng.randint(1, max_gap)])
        ops.append(("hit", [now]) if rng.random() < hit_p else ("getHits", [now]))
    return ops


H = lambda t: ("hit", [t])
G = lambda t: ("getHits", [t])
rng = random.Random(362)

for _ in range(300):
    ops = random_ops(rng, 60, rng.choice([5, 50, 200, 400]))
    assert run(mod.HitCounter, ops) == run(Model, ops)

tests = [
    case("s1", False, [H(1), H(2), H(2), G(4), H(300), G(300), G(301), G(302), G(1000)],
         "At time 301 the hit from time 1 is exactly 300 s old and no longer counts."),
    case("s2", False, [G(1), H(5), G(5), G(304), G(305)],
         "A hit counts for queries at 5..304 and expires at 305."),
    case("h-boundary", True, [H(100), H(100), H(101), G(399), G(400), G(401), G(402)]),
    case("h-burst-one-second", True, [H(7)] * 500 + [G(7), G(306), G(307)],
         "500 hits in the same second."),
    case("h-same-slot-reuse", True, [H(10), H(310), G(310), H(610), H(610), G(610), G(909), G(910)],
         "Times 10, 310, 610 share a bucket modulo 300; stale counts must be reset."),
    case("h-big-timestamps", True, [H(2 * 10**9 - 600), H(2 * 10**9 - 299), H(2 * 10**9 - 1), G(2 * 10**9 - 1), G(2 * 10**9)]),
    case("h-long-idle", True, [H(1), H(2), G(10**9), H(10**9), G(10**9), G(10**9 + 299), G(10**9 + 300)]),
]
for k, (n, gap) in enumerate([(50, 3), (150, 20), (400, 100), (800, 400)]):
    tests.append(case(f"h-rand-{k}", True, random_ops(rng, n, gap)))
tests.append(case("h-dense", True, random_ops(rng, 2500, 2, hit_p=0.8), "Thousands of hits inside one window."))
tests.append(case("h-large", True, random_ops(rng, 3000, 60, start=10**9)))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
