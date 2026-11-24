"""Regenerates tests.json deterministically from the Python reference solution.

Every operation sequence is also replayed against a brute-force model (a plain list in recency
order) and the two must agree before anything is written.
"""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


class Model:
    def __init__(self, cap):
        self.cap, self.items = cap, []  # [(key, value)], index 0 = least recent

    def get(self, key):
        for i, (k, v) in enumerate(self.items):
            if k == key:
                self.items.append(self.items.pop(i))
                return v
        return -1

    def put(self, key, value):
        for i, (k, _) in enumerate(self.items):
            if k == key:
                self.items.pop(i)
                self.items.append((key, value))
                return None
        self.items.append((key, value))
        if len(self.items) > self.cap:
            self.items.pop(0)
        return None


def run(cls, cap, ops):
    obj = cls(cap)
    return [getattr(obj, m)(*a) for m, a in ops]


def case(id, hidden, cap, ops, explanation=None):
    expected = run(mod.LRUCache, cap, ops)
    assert expected == run(Model, cap, ops), id
    t = {"id": id, "hidden": hidden, "ctorArgs": [cap],
         "calls": [{"method": m, "args": a} for m, a in ops], "expected": expected}
    if explanation: t["explanation"] = explanation
    return t


def random_ops(rng, n, key_range, get_ratio=0.5):
    ops = []
    for _ in range(n):
        k = rng.randint(0, key_range)
        if rng.random() < get_ratio:
            ops.append(("get", [k]))
        else:
            ops.append(("put", [k, rng.randint(0, 10**5)]))
    return ops


P = lambda k, v: ("put", [k, v])
G = lambda k: ("get", [k])
rng = random.Random(146)

# Self-check on many small random sequences first.
for _ in range(300):
    cap = rng.randint(1, 5)
    ops = random_ops(rng, 60, rng.randint(1, 10))
    assert run(mod.LRUCache, cap, ops) == run(Model, cap, ops)

tests = [
    case("s1", False, 2, [P(1, 10), P(2, 20), G(1), P(3, 30), G(2), P(1, 11), P(4, 40), G(3), G(1), G(4)],
         "get(1) makes key 2 the least recently used, so put(3) evicts 2; later put(4) evicts 3."),
    case("s2", False, 1, [P(5, 1), G(5), P(6, 2), G(5), G(6)],
         "With capacity 1 every new key evicts the previous one."),
    case("s3", False, 2, [P(1, 1), P(2, 2), P(1, 100), P(3, 3), G(2), G(1), G(3)],
         "Updating key 1 counts as a use, so key 2 is evicted, not key 1."),
    case("h-miss-on-empty", True, 3, [G(0), G(7), P(0, 0), G(0)]),
    case("h-update-no-evict", True, 2, [P(1, 1), P(2, 2), P(2, 3), P(1, 4), G(1), G(2)],
         "Updates of existing keys must never evict."),
    case("h-miss-not-a-use", True, 2, [P(1, 1), P(2, 2), G(9), P(3, 3), G(1), G(2), G(3)],
         "A missed get does not change recency: key 1 is still evicted."),
    case("h-get-refresh-chain", True, 3, [P(1, 1), P(2, 2), P(3, 3), G(1), G(2), P(4, 4), G(3), G(1), G(2), G(4)]),
    case("h-zero-values", True, 2, [P(0, 0), G(0), P(1, 0), G(1), P(2, 0), G(0)]),
]
for k, (n, cap, keys) in enumerate([(40, 2, 4), (80, 3, 8), (150, 5, 12), (300, 10, 25), (600, 1, 3), (800, 50, 120)]):
    tests.append(case(f"h-rand-{k}", True, cap, random_ops(rng, n, keys)))
tests.append(case("h-get-heavy", True, 20, random_ops(rng, 1000, 40, get_ratio=0.85)))
tests.append(case("h-put-heavy", True, 30, random_ops(rng, 1000, 200, get_ratio=0.15)))
# Large: capacity 1500 over 3000 keys, about half hits.
tests.append(case("h-large", True, 1500, random_ops(rng, 3500, 3000)))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
