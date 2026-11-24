"""Regenerates tests.json deterministically from the Python reference solution.

Every operation sequence is replayed against a brute-force model (an owner array scanned unit by
unit) and the two must agree before anything is written.
"""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


class Model:
    def __init__(self, n):
        self.mem = [0] * n

    def allocate(self, size, mID):
        run = 0
        for i, owner in enumerate(self.mem):
            run = run + 1 if owner == 0 else 0
            if run == size:
                start = i - size + 1
                for j in range(start, i + 1):
                    self.mem[j] = mID
                return start
        return -1

    def freeMemory(self, mID):
        count = 0
        for i, owner in enumerate(self.mem):
            if owner == mID:
                self.mem[i] = 0
                count += 1
        return count


def run(cls, n, ops):
    obj = cls(n)
    return [getattr(obj, m)(*a) for m, a in ops]


def case(id, hidden, n, ops, explanation=None, check=True):
    expected = run(mod.Allocator, n, ops)
    if check:
        assert expected == run(Model, n, ops), id
    t = {"id": id, "hidden": hidden, "ctorArgs": [n],
         "calls": [{"method": m, "args": a} for m, a in ops], "expected": expected}
    if explanation: t["explanation"] = explanation
    return t


def random_ops(rng, count, n, max_size, ids, free_ratio=0.35):
    ops = []
    for _ in range(count):
        if rng.random() < free_ratio:
            ops.append(("freeMemory", [rng.randint(1, ids + 1)]))
        else:
            ops.append(("allocate", [rng.randint(1, max_size), rng.randint(1, ids)]))
    return ops


AL = lambda s, m: ("allocate", [s, m])
FR = lambda m: ("freeMemory", [m])
rng = random.Random(2502)
for _ in range(400):
    n = rng.randint(1, 30)
    ops = random_ops(rng, 50, n, rng.randint(1, n), rng.randint(1, 6))
    assert run(mod.Allocator, n, ops) == run(Model, n, ops)

tests = [
    case("s1", False, 10, [AL(3, 1), AL(2, 2), AL(4, 1), FR(2), AL(3, 3), AL(1, 3), FR(1), AL(6, 4), FR(9)],
         "After freeing mID 1 the free runs [4..9] merge into one run of 6 units."),
    case("s2", False, 5, [AL(5, 7), AL(1, 8), FR(7), AL(1, 8), AL(4, 8), FR(8)],
         "mID 8 owns two blocks; freeing it returns their total size."),
    case("s3", False, 1, [AL(2, 1), AL(1, 1), AL(1, 2), FR(2), FR(1), AL(1, 2)]),
    case("h-coalesce-both-sides", True, 9,
         [AL(3, 1), AL(3, 2), AL(3, 3), FR(1), FR(3), AL(4, 4), FR(2), AL(9, 5)],
         "Freeing the middle block must merge with free runs on both sides."),
    case("h-first-fit-not-best-fit", True, 20,
         [AL(5, 1), AL(2, 2), AL(3, 3), AL(2, 4), FR(1), FR(3), AL(3, 5), AL(3, 6), AL(5, 7)],
         "First fit takes the lowest address that fits, not the tightest hole."),
    case("h-exact-size", True, 6, [AL(2, 1), AL(2, 2), AL(2, 3), AL(1, 4), FR(2), AL(2, 4), AL(1, 5)]),
    case("h-free-unknown", True, 4, [FR(1), FR(100000), AL(4, 100000), FR(100000), FR(100000)]),
    case("h-same-id-reuse", True, 8, [AL(2, 1), AL(2, 1), AL(2, 2), AL(2, 1), FR(1), AL(4, 3), AL(2, 3), FR(3)]),
    case("h-fragmented", True, 16,
         [AL(1, i % 2 + 1) for i in range(16)] + [FR(1), AL(2, 3), AL(1, 3), FR(2), AL(16, 4), AL(15, 4)]),
]
for k, (cnt, n, mx, ids) in enumerate([(40, 20, 6, 4), (100, 50, 10, 6), (200, 100, 30, 10), (400, 300, 40, 20),
                                       (600, 1000, 100, 50), (800, 64, 4, 30)]):
    tests.append(case(f"h-rand-{k}", True, n, random_ops(rng, cnt, n, mx, ids)))
# Large: many tiny blocks fragment a big region; then large requests have to walk the free list.
n = 100000
ops = [AL(rng.randint(1, 3), i) for i in range(1, 1501)]
ops += [FR(i) for i in range(1, 1501, 2)]
ops += [AL(rng.randint(1, 4), rng.randint(1501, 3000)) for _ in range(700)] + [AL(rng.randint(100, 5000), 3001) for _ in range(100)]
tests.append(case("h-large-fragmented", True, n, ops, check=False))
tests.append(case("h-large-random", True, n, random_ops(rng, 1200, n, 3000, 400), check=False))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
