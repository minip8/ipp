"""Regenerates tests.json deterministically from the Python reference solution.

Every operation sequence is also replayed against a brute-force model (scan for the minimum
(count, last use) on eviction) and the two must agree before anything is written.
"""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


class Model:
    def __init__(self, cap):
        self.cap, self.d, self.clock = cap, {}, 0  # key -> [value, count, last_use]

    def _use(self, key):
        self.clock += 1
        self.d[key][1] += 1
        self.d[key][2] = self.clock

    def get(self, key):
        if key not in self.d:
            return -1
        self._use(key)
        return self.d[key][0]

    def put(self, key, value):
        if key in self.d:
            self.d[key][0] = value
            self._use(key)
            return None
        if len(self.d) >= self.cap:
            victim = min(self.d, key=lambda k: (self.d[k][1], self.d[k][2]))
            del self.d[victim]
        self.clock += 1
        self.d[key] = [value, 1, self.clock]
        return None


def run(cls, cap, ops):
    obj = cls(cap)
    return [getattr(obj, m)(*a) for m, a in ops]


def case(id, hidden, cap, ops, explanation=None):
    expected = run(mod.LFUCache, cap, ops)
    assert expected == run(Model, cap, ops), id
    t = {"id": id, "hidden": hidden, "ctorArgs": [cap],
         "calls": [{"method": m, "args": a} for m, a in ops], "expected": expected}
    if explanation: t["explanation"] = explanation
    return t


def random_ops(rng, n, key_range, get_ratio=0.5, hot=None):
    ops = []
    for _ in range(n):
        if hot and rng.random() < 0.5:
            k = rng.randint(0, hot)          # a small hot set gets high counts
        else:
            k = rng.randint(0, key_range)
        if rng.random() < get_ratio:
            ops.append(("get", [k]))
        else:
            ops.append(("put", [k, rng.randint(0, 10**9)]))
    return ops


P = lambda k, v: ("put", [k, v])
G = lambda k: ("get", [k])
rng = random.Random(460)

for _ in range(400):
    cap = rng.randint(1, 5)
    ops = random_ops(rng, 80, rng.randint(1, 10))
    assert run(mod.LFUCache, cap, ops) == run(Model, cap, ops)

tests = [
    case("s1", False, 2, [P(1, 10), P(2, 20), G(1), P(3, 30), G(2), G(3), P(4, 40), G(1), G(3), G(4)],
         "Key 2 has the lowest count when 3 arrives. When 4 arrives keys 1 and 3 both have count 2, and key 1 was used longer ago."),
    case("s2", False, 1, [P(1, 1), G(1), G(1), P(2, 2), G(1), G(2)],
         "With capacity 1 the only entry is always evicted, whatever its count."),
    case("s3", False, 2, [P(1, 1), P(2, 2), P(1, 5), P(3, 3), G(1), G(2), G(3)],
         "put on an existing key counts as a use: key 1 reaches count 2, so key 2 is evicted."),
    case("h-new-key-evicted-next", True, 2, [P(1, 1), G(1), G(1), P(2, 2), P(3, 3), G(2), G(1), G(3)],
         "A freshly inserted key has count 1, so it is the next victim."),
    case("h-min-count-reset", True, 3, [P(1, 1), P(2, 2), P(3, 3), G(1), G(2), G(3), G(1), G(2), G(3),
                                       P(4, 4), P(5, 5), G(4), G(5), G(1), G(2), G(3)],
         "After inserting key 4 the minimum count must drop back to 1."),
    case("h-miss-not-a-use", True, 2, [P(1, 1), P(2, 2), G(7), G(8), P(3, 3), G(1), G(2), G(3)]),
    case("h-tie-by-last-use", True, 3, [P(1, 1), P(2, 2), P(3, 3), G(3), G(2), G(1), P(4, 4), G(3), G(2), G(1), G(4)],
         "All three have count 2; key 3 was used longest ago."),
    case("h-update-no-evict", True, 2, [P(1, 1), P(2, 2), P(2, 3), P(2, 4), P(1, 9), G(1), G(2)]),
]
for k, (n, cap, keys) in enumerate([(40, 2, 4), (80, 3, 8), (150, 5, 12), (300, 10, 25), (500, 1, 3), (800, 40, 120)]):
    tests.append(case(f"h-rand-{k}", True, cap, random_ops(rng, n, keys)))
tests.append(case("h-hot-set", True, 30, random_ops(rng, 1500, 300, hot=20)))
tests.append(case("h-get-heavy", True, 20, random_ops(rng, 1000, 60, get_ratio=0.85)))
tests.append(case("h-large", True, 1000, random_ops(rng, 2500, 2500, hot=300)))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
