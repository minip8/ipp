"""Regenerates tests.json deterministically from the Python reference solution.

Every sequence is replayed against a brute-force model (a plain Python list) and both must agree.
"""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


class Model:
    def __init__(self, cap): self.cap, self.a = cap, []
    def enqueue(self, v):
        if len(self.a) == self.cap: return False
        self.a.append(v); return True
    def dequeue(self):
        if not self.a: return False
        self.a.pop(0); return True
    def front(self): return self.a[0] if self.a else -1
    def rear(self): return self.a[-1] if self.a else -1
    def isEmpty(self): return not self.a
    def isFull(self): return len(self.a) == self.cap


def run(cls, cap, ops):
    obj = cls(cap)
    return [getattr(obj, m)(*a) for m, a in ops]


def case(id, hidden, cap, ops, explanation=None):
    expected = run(mod.CircularQueue, cap, ops)
    assert expected == run(Model, cap, ops), id
    t = {"id": id, "hidden": hidden, "ctorArgs": [cap],
         "calls": [{"method": m, "args": a} for m, a in ops], "expected": expected}
    if explanation: t["explanation"] = explanation
    return t


def random_ops(rng, n, enq_bias=0.4):
    ops = []
    for _ in range(n):
        r = rng.random()
        if r < enq_bias:
            ops.append(("enqueue", [rng.randint(0, 10**6)]))
        elif r < enq_bias + 0.3:
            ops.append(("dequeue", []))
        else:
            ops.append((rng.choice(["front", "rear", "isEmpty", "isFull"]), []))
    return ops


E = lambda v: ("enqueue", [v])
D = ("dequeue", [])
F, R, IE, IF = ("front", []), ("rear", []), ("isEmpty", []), ("isFull", [])
rng = random.Random(622)

for _ in range(300):
    cap = rng.randint(1, 5)
    ops = random_ops(rng, 60, rng.choice([0.3, 0.4, 0.55]))
    assert run(mod.CircularQueue, cap, ops) == run(Model, cap, ops)

tests = [
    case("s1", False, 3, [E(1), E(2), E(3), E(4), R, IF, D, E(4), F, R],
         "The fourth enqueue fails while full; after one dequeue the freed slot is reused."),
    case("s2", False, 2, [IE, F, R, D, E(7), F, R, D, IE],
         "front/rear return -1 and dequeue returns false on an empty queue."),
    case("h-cap1", True, 1, [E(5), E(6), F, R, IF, D, D, E(6), F, R, IE],
         "Capacity 1: the only slot is reused."),
    case("h-wrap-rear", True, 3, [E(1), E(2), E(3), D, D, E(4), E(5), R, F, D, R, F, D, D, R, IE],
         "rear after the write position wraps to index 0 must read the last slot."),
    case("h-zero-value", True, 2, [E(0), F, R, E(0), IF, D, F]),
    case("h-many-laps", True, 4, [x for i in range(30) for x in (E(i), E(i + 100), D, F, D, R, IE)]),
    case("h-fill-drain", True, 5, [E(i) for i in range(7)] + [IF, R] + [x for _ in range(6) for x in (F, D)] + [IE, R]),
]
for k, (n, cap) in enumerate([(40, 2), (80, 3), (200, 5), (400, 8), (800, 1), (600, 50)]):
    tests.append(case(f"h-rand-{k}", True, cap, random_ops(rng, n)))
tests.append(case("h-mostly-full", True, 16, random_ops(rng, 1200, 0.55)))
tests.append(case("h-mostly-empty", True, 16, random_ops(rng, 800, 0.3)))
tests.append(case("h-large", True, 1000, random_ops(rng, 2000, 0.6)))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
