"""Regenerates tests.json deterministically from the Python reference solution.

Every sequence is replayed against a brute-force model (full copy of the array on each snap).
The large tests are checked against a sparse model instead (dict of changes per snapshot).
"""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


class Model:
    def __init__(self, n): self.live, self.snaps = [0] * n, []
    def set(self, i, v): self.live[i] = v
    def snap(self): self.snaps.append(list(self.live)); return len(self.snaps) - 1
    def get(self, i, s): return self.snaps[s][i]


class SparseModel:
    """Live dict of changes since last snap; get walks back through per-snap change dicts."""
    def __init__(self, n): self.pending, self.diffs = {}, []
    def set(self, i, v): self.pending[i] = v
    def snap(self): self.diffs.append(self.pending); self.pending = {}; return len(self.diffs) - 1
    def get(self, i, s):
        for d in reversed(self.diffs[:s + 1]):
            if i in d: return d[i]
        return 0


def run(cls, n, ops):
    obj = cls(n)
    return [getattr(obj, m)(*a) for m, a in ops]


def case(id, hidden, n, ops, explanation=None, model=Model):
    expected = run(mod.SnapshotArray, n, ops)
    assert expected == run(model, n, ops), id
    t = {"id": id, "hidden": hidden, "ctorArgs": [n],
         "calls": [{"method": m, "args": a} for m, a in ops], "expected": expected}
    if explanation: t["explanation"] = explanation
    return t


def random_ops(rng, n, length, weights=(0.45, 0.15, 0.4), vmax=10**9):
    ops, snaps = [], 0
    for _ in range(n):
        m = rng.choices(["set", "snap", "get"], weights)[0]
        if m == "get" and snaps == 0: m = "snap"
        if m == "set": ops.append(("set", [rng.randrange(length), rng.randint(0, vmax)]))
        elif m == "snap": ops.append(("snap", [])); snaps += 1
        else: ops.append(("get", [rng.randrange(length), rng.choice([snaps - 1, rng.randrange(snaps)])]))
    return ops


S = lambda i, v: ("set", [i, v])
N = ("snap", [])
G = lambda i, s: ("get", [i, s])
rng = random.Random(1146)

for _ in range(300):
    length = rng.randint(1, 4)
    ops = random_ops(rng, 40, length, vmax=3)
    assert run(mod.SnapshotArray, length, ops) == run(Model, length, ops)

tests = [
    case("s1", False, 3, [S(0, 5), N, S(0, 6), S(2, 1), N, N, G(0, 0), G(0, 1), G(2, 0), G(2, 2), G(1, 2)],
         "Snapshot 0 saw only element 0 = 5; snapshots 1 and 2 are identical."),
    case("s2", False, 1, [N, S(0, 4), S(0, 7), N, G(0, 0), G(0, 1), S(0, 9), G(0, 1)],
         "Only the last set before a snap matters, and sets after a snap do not change it."),
    case("h-set-back-to-zero", True, 2, [S(0, 3), N, S(0, 0), N, G(0, 0), G(0, 1), G(1, 1)]),
    case("h-many-sets-one-snap", True, 2, [S(1, v) for v in range(1, 30)] + [N, G(1, 0), S(1, 100), N, G(1, 0), G(1, 1)]),
    case("h-snap-first", True, 4, [N, N, G(3, 1), S(3, 8), G(3, 1), N, G(3, 2), G(3, 0)]),
    case("h-gaps", True, 3, [S(0, 1), N] + [N] * 20 + [S(0, 2), N] + [G(0, s) for s in (0, 1, 5, 20, 21)]),
]
for k, (n, length) in enumerate([(50, 2), (120, 5), (300, 20), (600, 100)]):
    tests.append(case(f"h-rand-{k}", True, length, random_ops(rng, n, length)))
# Long array with many snapshots: copying the array on every snap is 50000 * 1000 element copies.
ops = random_ops(rng, 2500, 50000, weights=(0.3, 0.4, 0.3))
tests.append(case("h-many-snaps-long-array", True, 50000, ops, model=SparseModel))
# A few hot indices with long histories, many queries into old snapshots.
ops = random_ops(rng, 2500, 8, weights=(0.4, 0.2, 0.4))
tests.append(case("h-deep-history", True, 8, ops, model=SparseModel))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
