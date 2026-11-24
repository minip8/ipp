"""Regenerates tests.json deterministically from the Python reference solution.

Every sequence is replayed against a brute-force model (association list) and both must agree.
"""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


class Model:
    def __init__(self): self.a = []
    def put(self, k, v):
        for i, (kk, _) in enumerate(self.a):
            if kk == k: self.a[i] = (k, v); return None
        self.a.append((k, v))
    def get(self, k):
        for kk, v in self.a:
            if kk == k: return v
        return -1
    def remove(self, k):
        self.a = [(kk, v) for kk, v in self.a if kk != k]


def run(cls, ops):
    obj = cls()
    return [getattr(obj, m)(*a) for m, a in ops]


def case(id, hidden, ops, explanation=None):
    expected = run(mod.MyHashMap, ops)
    assert expected == run(Model, ops), id
    t = {"id": id, "hidden": hidden, "ctorArgs": [],
         "calls": [{"method": m, "args": a} for m, a in ops], "expected": expected}
    if explanation: t["explanation"] = explanation
    return t


def random_ops(rng, n, keys, weights=(0.4, 0.4, 0.2)):
    ops = []
    for _ in range(n):
        k = rng.choice(keys)
        m = rng.choices(["put", "get", "remove"], weights)[0]
        ops.append(("put", [k, rng.randint(0, 10**9)]) if m == "put" else (m, [k]))
    return ops


P = lambda k, v: ("put", [k, v])
G = lambda k: ("get", [k])
R = lambda k: ("remove", [k])
rng = random.Random(706)

for _ in range(200):
    keys = [rng.randint(0, 40) for _ in range(8)]
    ops = random_ops(rng, 80, keys)
    assert run(mod.MyHashMap, ops) == run(Model, ops)

# Keys that collide under naive "key % m" for common table sizes.
colliders = [i * 1024 * 1000 * 997 % (10**9) for i in range(1, 9)] + [i * 2**20 for i in range(1, 9)] + [i * 10007 for i in range(1, 9)]

tests = [
    case("s1", False, [P(3, 30), P(1003, 7), G(3), G(1003), G(5), P(3, 31), R(1003), G(1003), G(3), R(42)],
         "Overwriting key 3 replaces its value; removing an absent key does nothing."),
    case("s2", False, [P(0, 0), G(0), R(0), G(0), P(0, 5), G(0)],
         "Value 0 is a real value, distinct from 'absent' (-1)."),
    case("h-big-keys", True, [P(10**9, 1), P(10**9 - 1, 2), P(0, 3), G(10**9), G(10**9 - 1), G(0), G(1), R(10**9), G(10**9)],
         "Keys up to 10^9 rule out a direct-address array."),
    case("h-probe-chain", True,
         [P(k, i) for i, k in enumerate(colliders)] + [R(k) for k in colliders[::3]] + [G(k) for k in colliders]
         + [P(k, 99) for k in colliders[1::3]] + [G(k) for k in colliders],
         "Many colliding keys with deletions in the middle of probe runs (tombstone handling)."),
    case("h-remove-reinsert", True, [x for i in range(50) for x in (P(7, i), R(7), G(7), P(7, i + 1), G(7))],
         "Repeated remove/reinsert of one key must not leak duplicates."),
    case("h-remove-absent", True, [R(1), R(2), G(1), P(1, 1), R(2), G(1)]),
]
for k, (n, nkeys) in enumerate([(50, 5), (100, 20), (300, 50), (600, 200)]):
    keys = [rng.randint(0, 10**9) for _ in range(nkeys)]
    tests.append(case(f"h-rand-{k}", True, random_ops(rng, n, keys)))
tests.append(case("h-colliding-rand", True, random_ops(rng, 600, colliders)))
tests.append(case("h-churn", True, random_ops(rng, 800, list(range(0, 4000, 4)), weights=(0.35, 0.3, 0.35))))
keys = rng.sample(range(10**9), 1500)
growth = [P(k, i) for i, k in enumerate(keys)] + [G(k) for k in rng.sample(keys, 300)] + [G(rng.randint(0, 10**9)) for _ in range(100)]
tests.append(case("h-growth", True, growth, "1500 distinct keys: the table must grow."))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
