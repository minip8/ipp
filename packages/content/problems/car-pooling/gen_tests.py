"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib, copy

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def peak(trips):
    """Max load via a difference array (independent of the sweep)."""
    hi = max(t[2] for t in trips) + 1
    d = [0] * (hi + 1)
    for p, a, b in trips: d[a] += p; d[b] -= p
    best = cur = 0
    for x in d: cur += x; best = max(best, cur)
    return best

def case(id, hidden, trips, cap, explanation=None):
    exp = peak(trips) <= cap
    assert mod.Solution().carPooling(copy.deepcopy(trips), cap) == exp
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "carPooling", "args": [trips, cap]}], "expected": [exp]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(1094)
def gen(n, span, maxlen):
    out = []
    for _ in range(n):
        a = rng.randint(0, span - 1); out.append([rng.randint(1, 100), a, min(span, a + rng.randint(1, maxlen))])
    return out
for _ in range(2000):
    tr = gen(rng.randint(1, 5), 10, 5); cap = rng.randint(1, 300)
    assert mod.Solution().carPooling(tr, cap) == (peak(tr) <= cap)

tests = [
    case("s1", False, [[2, 1, 5], [3, 3, 7]], 4, "Between km 3 and 5 there are 5 passengers."),
    case("s2", False, [[2, 1, 5], [3, 3, 7]], 5),
    case("s3", False, [[3, 2, 6], [4, 6, 9]], 4, "Drop-offs at km 6 happen before pick-ups."),
    case("h-single-over", True, [[10, 0, 1]], 9),
    case("h-single-exact", True, [[10, 0, 1000000]], 10),
    case("h-chain-touching", True, [[5, 0, 2], [5, 2, 4], [5, 4, 6], [5, 6, 8]], 5),
    case("h-nested", True, [[1, 0, 100], [1, 10, 90], [1, 20, 80], [1, 30, 70]], 3),
    case("h-same-start", True, [[2, 5, 6], [2, 5, 9], [2, 5, 7]], 6),
]
for k, (n, span, ml) in enumerate([(10, 50, 10), (100, 1000, 100), (800, 10**6, 50000), (1000, 500, 20)]):
    tr = gen(n, span, ml); pk = peak(tr)
    tests.append(case(f"h-rand-ok-{k}", True, tr, pk))
    tests.append(case(f"h-rand-bad-{k}", True, tr, pk - 1))
big = gen(5000, 10**6, 20000); pk = peak(big)
tests.append(case("h-large-exact", True, big, pk))
tests.append(case("h-large-one-short", True, big, pk - 1))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
