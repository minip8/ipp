"""Regenerates tests.json deterministically from the Python reference solution.

Every operation sequence is replayed against a brute-force model (full copy of the store on
every begin, counts by scanning) and the two must agree before anything is written.
"""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


class Model:
    def __init__(self):
        self.data, self.snaps = {}, []

    def set(self, k, v):
        self.data[k] = v

    def get(self, k):
        return self.data.get(k, -1)

    def unset(self, k):
        self.data.pop(k, None)

    def count(self, v):
        return sum(1 for x in self.data.values() if x == v)

    def begin(self):
        self.snaps.append(dict(self.data))

    def rollback(self):
        if not self.snaps:
            return False
        self.data = self.snaps.pop()
        return True

    def commit(self):
        if not self.snaps:
            return False
        self.snaps.pop()
        return True


def run(cls, ops):
    obj = cls()
    return [getattr(obj, m)(*a) for m, a in ops]


def case(id, hidden, ops, explanation=None, check=True):
    expected = run(mod.KVStore, ops)
    if check:
        assert expected == run(Model, ops), id
    t = {"id": id, "hidden": hidden, "ctorArgs": [],
         "calls": [{"method": m, "args": a} for m, a in ops], "expected": expected}
    if explanation: t["explanation"] = explanation
    return t


def random_ops(rng, n, keys, values, tx_ratio=0.15):
    names = ["".join(rng.choice("abcdefghij") for _ in range(rng.randint(1, 3))) for _ in range(keys)]
    ops = []
    for _ in range(n):
        r = rng.random()
        if r < tx_ratio:
            ops.append((rng.choice(["begin", "begin", "commit", "rollback"]), []))
        elif r < 0.5:
            ops.append(("set", [rng.choice(names), rng.randint(0, values)]))
        elif r < 0.6:
            ops.append(("unset", [rng.choice(names)]))
        elif r < 0.8:
            ops.append(("get", [rng.choice(names)]))
        else:
            ops.append(("count", [rng.randint(0, values)]))
    return ops


S = lambda k, v: ("set", [k, v])
G = lambda k: ("get", [k])
U = lambda k: ("unset", [k])
C = lambda v: ("count", [v])
BEGIN, COMMIT, ROLLBACK = ("begin", []), ("commit", []), ("rollback", [])
rng = random.Random(1337)
for _ in range(400):
    ops = random_ops(rng, 60, rng.randint(1, 5), rng.randint(0, 4), tx_ratio=0.25)
    assert run(mod.KVStore, ops) == run(Model, ops)

tests = [
    case("s1", False, [S("a", 10), BEGIN, S("a", 20), S("b", 20), C(20), BEGIN, U("a"), G("a"), ROLLBACK, G("a"),
                       COMMIT, ROLLBACK, G("a"), C(10)],
         "Rolling back the inner transaction restores a = 20; the outer commit keeps it."),
    case("s2", False, [BEGIN, S("x", 1), BEGIN, S("x", 2), COMMIT, G("x"), ROLLBACK, G("x"), C(1), C(2)],
         "After the inner commit, x = 2 belongs to the outer transaction; rolling that back removes x entirely."),
    case("s3", False, [COMMIT, ROLLBACK, S("k", 5), U("k"), U("k"), G("k"), C(5)],
         "commit and rollback return false with no open transaction; unsetting a missing key is a no-op."),
    case("h-repeated-writes", True, [S("a", 1), BEGIN, S("a", 2), S("a", 3), U("a"), S("a", 4), ROLLBACK, G("a"), C(1), C(4)],
         "Only the value before the first touch matters for rollback."),
    case("h-rollback-restores-absent", True, [BEGIN, S("n", 7), C(7), ROLLBACK, G("n"), C(7)]),
    case("h-unset-in-tx", True, [S("a", 3), S("b", 3), BEGIN, U("a"), C(3), BEGIN, U("b"), C(3), ROLLBACK, C(3),
                                 ROLLBACK, C(3), G("a"), G("b")]),
    case("h-commit-merge-keeps-older", True,
         [S("a", 1), BEGIN, S("a", 2), BEGIN, S("a", 3), S("b", 9), COMMIT, G("a"), ROLLBACK, G("a"), G("b"), C(9)],
         "The outer log already knows a's original value (1); the merge must not overwrite it with 2."),
    case("h-deep-nesting", True, [BEGIN] * 5 + [S("d", i) for i in range(5)] + [ROLLBACK, G("d"), COMMIT, COMMIT, G("d"),
                                                                                 ROLLBACK, G("d"), ROLLBACK, ROLLBACK, G("d")]),
    case("h-count-zero-values", True, [S("a", 0), S("b", 0), C(0), U("a"), C(0), BEGIN, S("b", 1), C(0), C(1), ROLLBACK, C(0)]),
    case("h-set-same-value", True, [S("a", 5), BEGIN, S("a", 5), C(5), ROLLBACK, C(5), G("a")]),
]
for k, (n, keys, vals, tx) in enumerate([(40, 3, 3, 0.2), (100, 5, 5, 0.2), (300, 10, 10, 0.15), (600, 30, 20, 0.1),
                                         (800, 4, 2, 0.3), (700, 100, 50, 0.05)]):
    tests.append(case(f"h-rand-{k}", True, random_ops(rng, n, keys, vals, tx)))
# Large store, many small transactions: copy-on-begin costs O(store) per begin.
big = [S(f"k{i}", i % 1000) for i in range(2000)]
names = [f"k{i}" for i in range(2000)]
for _ in range(500):
    big.append(BEGIN)
    big.append(S(rng.choice(names), rng.randint(0, 999)))
    big.append(rng.choice([COMMIT, ROLLBACK]))
big += [C(v) for v in range(0, 1000, 37)]
tests.append(case("h-large-store", True, big))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
