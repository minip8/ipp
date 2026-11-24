"""Regenerates tests.json deterministically from the Python reference solution.

Every sequence is replayed against a brute-force model (flattened copy plus an index). Call
sequences only call next() when an element remains.
"""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


class Model:
    def __init__(self, vec): self.a, self.i = [x for r in vec for x in r], 0
    def next(self): self.i += 1; return self.a[self.i - 1]
    def hasNext(self): return self.i < len(self.a)


def run(cls, vec, ops):
    obj = cls([list(r) for r in vec])
    return [getattr(obj, m)() for m in ops]


def case(id, hidden, vec, ops, explanation=None):
    expected = run(mod.Vector2D, vec, ops)
    assert expected == run(Model, vec, ops), id
    t = {"id": id, "hidden": hidden, "ctorArgs": [vec],
         "calls": [{"method": m, "args": []} for m in ops], "expected": expected}
    if explanation: t["explanation"] = explanation
    return t


def drain(vec, rng=None, has_p=0.5):
    """Calls that consume every element, with random extra hasNext calls, ending with hasNext."""
    total = sum(len(r) for r in vec)
    ops = []
    for _ in range(total):
        while rng and rng.random() < has_p:
            ops.append("hasNext")
        ops.append("next")
    return ops + ["hasNext"]


def rand_vec(rng, rows, max_len, empty_p=0.3):
    return [[] if rng.random() < empty_p else [rng.randint(-1000, 1000) for _ in range(rng.randint(1, max_len))]
            for _ in range(rows)]


rng = random.Random(251)

for _ in range(300):
    vec = rand_vec(rng, rng.randint(0, 5), 3, 0.4)
    ops = drain(vec, rng)
    cut = rng.randint(0, len(ops))
    assert run(mod.Vector2D, vec, ops[:cut]) == run(Model, vec, ops[:cut])

tests = [
    case("s1", False, [[1, 2], [], [3], [], []], ["hasNext", "next", "next", "hasNext", "hasNext", "next", "hasNext"],
         "Empty rows are skipped, including the trailing ones."),
    case("s2", False, [[], [5], [6, 7]], ["next", "next", "hasNext", "next", "hasNext"],
         "next() works without a preceding hasNext(), even when the first row is empty."),
    case("h-empty-outer", True, [], ["hasNext", "hasNext"]),
    case("h-only-empty-rows", True, [[], [], [], []], ["hasNext"]),
    case("h-many-empty", True, [[]] * 50 + [[9]] + [[]] * 50 + [[-9]] + [[]] * 50, ["next", "hasNext", "next", "hasNext"],
         "Long runs of empty rows need a loop, not a single skip."),
    case("h-hasnext-idempotent", True, [[1], [2, 3]], ["hasNext"] * 5 + ["next"] + ["hasNext"] * 5 + ["next", "next"] + ["hasNext"] * 3,
         "Repeated hasNext() must not consume elements."),
    case("h-single-row", True, [[4, 4, 4, -1000, 1000]], drain([[4, 4, 4, -1000, 1000]])),
    case("h-single-column", True, [[i] for i in range(20)], drain([[i] for i in range(20)])),
]
for k, (rows, ml, ep) in enumerate([(5, 3, 0.3), (20, 5, 0.5), (60, 10, 0.2), (150, 8, 0.7)]):
    vec = rand_vec(rng, rows, ml, ep)
    tests.append(case(f"h-rand-{k}", True, vec, drain(vec, rng, 0.4)))
vec = rand_vec(rng, 300, 3, 0.6)
ops = drain(vec, rng, 0.3)
tests.append(case("h-partial", True, vec, ops[: len(ops) // 2], "Stops halfway: no requirement to reach the end."))
# Large input: 500 x 500 values (many in empty-row runs), consumed with few calls.
big = [[] if rng.random() < 0.5 else [rng.randint(-1000, 1000) for _ in range(rng.randint(1, 30))] for _ in range(500)]
tests.append(case("h-large", True, big, drain(big)[:4000]))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
