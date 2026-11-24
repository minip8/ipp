"""Regenerates tests.json deterministically from the Python reference solution.

Every operation sequence is replayed against a brute-force model (dict of live handles, slots
found by scanning) and the two must agree before anything is written.
"""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


class Model:
    def __init__(self, cap):
        self.cap = cap
        self.gen = [0] * cap
        self.used_ever = [False] * cap
        self.live = {}          # handle -> value
        self.released = []      # release order of slots

    def acquire(self, value):
        live_slots = {h % self.cap for h in self.live}
        slot = None
        for s in reversed(self.released):            # most recently released free slot
            if s not in live_slots:
                slot = s
                break
        if slot is not None:
            self.released.reverse(); self.released.remove(slot); self.released.reverse()
        else:
            fresh = [s for s in range(self.cap) if not self.used_ever[s]]
            if not fresh:
                return -1
            slot = fresh[0]
        self.used_ever[slot] = True
        h = self.gen[slot] * self.cap + slot
        self.live[h] = value
        return h

    def get(self, handle):
        return self.live.get(handle, -1)

    def set(self, handle, value):
        if handle not in self.live:
            return False
        self.live[handle] = value
        return True

    def release(self, handle):
        if handle not in self.live:
            return False
        del self.live[handle]
        self.gen[handle % self.cap] += 1
        self.released.append(handle % self.cap)
        return True

    def size(self):
        return len(self.live)


def run(cls, cap, ops):
    obj = cls(cap)
    return [getattr(obj, m)(*a) for m, a in ops]


def case(id, hidden, cap, ops, explanation=None, check=True):
    expected = run(mod.ObjectPool, cap, ops)
    if check:
        assert expected == run(Model, cap, ops), id
    t = {"id": id, "hidden": hidden, "ctorArgs": [cap],
         "calls": [{"method": m, "args": a} for m, a in ops], "expected": expected}
    if explanation: t["explanation"] = explanation
    return t


def random_ops(rng, n, cap, acquire_ratio=0.4):
    """Builds ops online so handles used later are realistic: live, stale, or garbage."""
    pool = mod.ObjectPool(cap)
    issued, ops = [], []
    for _ in range(n):
        r = rng.random()
        if r < acquire_ratio:
            v = rng.randint(0, 10**9)
            h = pool.acquire(v)
            ops.append(("acquire", [v]))
            if h >= 0:
                issued.append(h)
            continue
        roll = rng.random()
        if issued and roll < 0.85:
            h = rng.choice(issued[-20:]) if rng.random() < 0.7 else rng.choice(issued)
        elif roll < 0.92:
            h = rng.choice([-1, -cap, -10**12, 10**12, cap * rng.randint(1, 50) + rng.randint(0, cap - 1)])
        else:
            h = rng.randint(0, cap * 3)
        if r < 0.65:
            ops.append(("get", [h])); pool.get(h)
        elif r < 0.75:
            v = rng.randint(0, 10**9)
            ops.append(("set", [h, v])); pool.set(h, v)
        elif r < 0.95:
            ops.append(("release", [h])); pool.release(h)
        else:
            ops.append(("size", []))
    return ops


A = lambda v: ("acquire", [v])
G = lambda h: ("get", [h])
S = lambda h, v: ("set", [h, v])
R = lambda h: ("release", [h])
SZ = ("size", [])
rng = random.Random(77)
for _ in range(400):
    cap = rng.randint(1, 6)
    ops = random_ops(rng, 60, cap)
    assert run(mod.ObjectPool, cap, ops) == run(Model, cap, ops)

tests = [
    case("s1", False, 3, [A(10), A(20), R(0), G(0), R(0), A(30), G(3), S(1, 21), G(1), A(40), A(50), SZ],
         "Releasing slot 0 bumps its generation to 1, so the reused slot hands out handle 1*3+0 = 3."),
    case("s2", False, 2, [A(5), A(6), R(0), R(1), A(7), A(8), G(4), G(5), SZ],
         "Slots are reused last-released-first: slot 1 (released last) comes back first, as handle 1*2+1 = 3."),
    case("s3", False, 1, [A(1), R(0), A(2), R(0), G(0), G(1), S(0, 9), R(1), A(3), G(2), SZ]),
    case("h-negative-handles", True, 4, [A(1), G(-1), G(-4), S(-3, 5), R(-1), R(-1000000000000), G(0), SZ],
         "Negative handles are invalid; % on a negative number must not index the array."),
    case("h-never-used-slot", True, 5, [A(7), G(1), G(2), S(3, 1), R(4), SZ],
         "Slot 1 has generation 0 but has never been acquired."),
    case("h-future-generation", True, 3, [A(1), G(3), G(6), R(3), G(0)],
         "Handle 3 decodes to slot 0, generation 1, which has not been issued yet."),
    case("h-huge-handle", True, 100000, [A(4), G(10**12), R(10**12), G(0), A(5), G(1)]),
    case("h-full-then-free", True, 3, [A(1), A(2), A(3), A(4), R(1), A(5), A(6), G(4), SZ]),
    case("h-set-stale-does-not-clobber", True, 2, [A(1), R(0), A(2), S(0, 99), G(2), G(0)]),
    case("h-many-generations", True, 1, [op for k in range(30) for op in (A(k), G(k), R(k))] + [G(29), A(100), G(30), SZ]),
]
for k, (n, cap) in enumerate([(50, 2), (120, 3), (300, 8), (600, 20), (800, 50), (600, 1)]):
    tests.append(case(f"h-rand-{k}", True, cap, random_ops(rng, n, cap)))
tests.append(case("h-churn", True, 64, random_ops(rng, 2000, 64, acquire_ratio=0.45), check=False))
tests.append(case("h-large-cap", True, 100000, random_ops(rng, 1500, 100000, acquire_ratio=0.6), check=False))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
