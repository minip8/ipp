"""Regenerates tests.json deterministically from the Python reference solution.

Every sequence is replayed against an independent model and both must agree. The model answers
pop/top/replaceTop from a sorted multiset, and keeps the array layout with a separate (recursive)
implementation of the statement's sift rules, checking the heap property and the multiset after
every call.
"""
import bisect, json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
EMPTY = -(2**31)


class Model:
    def __init__(self): self.vals, self.arr = [], []

    def _up(self, i):
        p = (i - 1) // 2
        if i > 0 and self.arr[i] > self.arr[p]:
            self.arr[i], self.arr[p] = self.arr[p], self.arr[i]; self._up(p)

    def _down(self, i):
        kids = [c for c in (2 * i + 1, 2 * i + 2) if c < len(self.arr)]
        if not kids: return
        c = max(kids, key=lambda k: (self.arr[k], -k))  # larger child, left on ties
        if self.arr[c] > self.arr[i]:
            self.arr[i], self.arr[c] = self.arr[c], self.arr[i]; self._down(c)

    def _check(self):
        a = self.arr
        if len(a) > 2000 and len(a) % 97: return  # keep generation fast on the large tests
        assert sorted(a) == self.vals
        assert all(a[(i - 1) // 2] >= a[i] for i in range(1, len(a)))

    def push(self, v):
        bisect.insort(self.vals, v); self.arr.append(v); self._up(len(self.arr) - 1); self._check()

    def pop(self):
        if not self.vals: return EMPTY
        top = self.vals.pop()
        self.arr[0] = self.arr[-1]; self.arr.pop()
        if self.arr: self._down(0)
        self._check(); return top

    def top(self): return self.vals[-1] if self.vals else EMPTY
    def size(self): return len(self.vals)

    def build(self, values):
        self.vals, self.arr = sorted(values), list(values)
        for i in reversed(range(len(values) // 2)): self._down(i)
        self._check()

    def replaceTop(self, v):
        if not self.vals: self.push(v); return EMPTY
        top = self.vals.pop(); bisect.insort(self.vals, v)
        self.arr[0] = v; self._down(0); self._check(); return top

    def toArray(self): return list(self.arr)


def run(cls, ops):
    obj = cls()
    return [getattr(obj, m)(*a) for m, a in ops]


def case(id, hidden, ops, explanation=None):
    expected = run(mod.BinaryHeap, ops)
    assert expected == run(Model, ops), id
    t = {"id": id, "hidden": hidden, "ctorArgs": [],
         "calls": [{"method": m, "args": a} for m, a in ops], "expected": expected}
    if explanation: t["explanation"] = explanation
    return t


P = lambda v: ("push", [v])
B = lambda vs: ("build", [list(vs)])
R = lambda v: ("replaceTop", [v])
PO, T, SZ, A = ("pop", []), ("top", []), ("size", []), ("toArray", [])


def random_ops(rng, n, lo, hi, push_bias=0.4):
    ops = []
    for _ in range(n):
        r = rng.random()
        if r < push_bias:
            ops.append(P(rng.randint(lo, hi)))
        elif r < push_bias + 0.25:
            ops.append(PO)
        elif r < push_bias + 0.35:
            ops.append(R(rng.randint(lo, hi)))
        elif r < push_bias + 0.37:
            ops.append(B([rng.randint(lo, hi) for _ in range(rng.randint(0, 12))]))
        elif r < push_bias + 0.45:
            ops.append(A)
        else:
            ops.append(rng.choice([T, SZ]))
    return ops


rng = random.Random(1964)  # Williams' heapsort paper

# Self-check on many small random sequences first.
for _ in range(400):
    ops = random_ops(rng, 80, -5, 5, rng.choice([0.3, 0.4, 0.5]))
    assert run(mod.BinaryHeap, ops) == run(Model, ops)

tests = [
    case("s1", False, [P(3), P(8), P(5), P(9), T, PO, A, R(1), A, B([1, 2, 3, 4, 5]), A, SZ],
         "The example: pushes sift up, pop moves the last element to the root, build sifts down from n/2 - 1."),
    case("s2", False, [T, PO, SZ, A, R(4), T, PO, PO, SZ],
         "top and pop on an empty heap return -2147483648; replaceTop on an empty heap just pushes."),
    case("s3", False, [B([1, 5, 5]), A, B([2, 7, 7, 1]), A, PO, A],
         "Equal children: sift down goes to the left one. build replaces the previous contents."),
    case("h-duplicates", True, [P(v) for v in (4, 4, 2, 4, 2, 2, 4)] + [A] + [PO] * 8 + [SZ],
         "Every pop of a duplicate value must leave the other copies in place."),
    case("h-negatives", True, [P(v) for v in (-5, -1, -9, -3, -1, -7)] + [T, A, PO, PO, PO, A, R(-100), A, PO, PO, PO, PO]),
    case("h-extremes", True,
         [P(-10**9), P(10**9), P(0), P(10**9), P(-10**9), A, PO, PO, PO, PO, PO, PO, T]),
    case("h-pop-to-empty", True, [P(1), P(2), PO, A, PO, A, PO, T, SZ, P(3), A],
         "Popping the last element must leave an empty heap, not a stale root."),
    case("h-left-child-only", True, [B([1, 2]), A, B([3, 1, 2, 0, 9]), A, B([5, 6, 7, 8, 1, 2]), A, PO, A, PO, A],
         "A node whose only child is the last element must still be sifted against it."),
    case("h-build-vs-push", True, [B(range(1, 11)), A] + [PO] * 3 + [A],
         "build sifts down bottom-up; pushing the same values one by one would give a different array."),
    case("h-push-ascending", True, [P(v) for v in range(1, 11)] + [A],
         "The same values pushed one at a time: compare with h-build-vs-push."),
    case("h-build-empty", True, [P(3), P(4), B([]), SZ, T, PO, A, B([7]), A, T],
         "build([]) discards everything; build of one element is that element."),
    case("h-build-sorted-desc", True, [B(range(9, 0, -1)), A, PO, PO, A]),
    case("h-replace-top", True,
         [B([10, 8, 9, 1, 2, 3]), R(0), A, R(100), A, R(100), A, R(5), A, PO, A],
         "replaceTop returns the old top even when the new value is larger than everything."),
    case("h-replace-equal", True, [B([4, 4, 4]), R(4), A, R(3), A, R(4), A],
         "Equal values everywhere: ties between children go left, and replaceTop returns the old top."),
]
for k, (n, lo, hi) in enumerate([(60, -3, 3), (120, -10, 10), (300, -100, 100), (500, -10**9, 10**9), (700, 0, 5)]):
    tests.append(case(f"h-rand-{k}", True, random_ops(rng, n, lo, hi)))

# Large: build from 20000 values, then many pops and replaceTops (each must be O(log n)).
big = [rng.randint(-999, 999) for _ in range(20000)]
ops = [B(big), SZ, T]
for _ in range(2500):
    r = rng.random()
    if r < 0.4: ops.append(PO)
    elif r < 0.7: ops.append(R(rng.randint(-999, 999)))
    elif r < 0.9: ops.append(P(rng.randint(-999, 999)))
    else: ops.append(T)
ops += [SZ]
tests.append(case("h-large-build", True, ops, "build of 20000 values, then 2500 operations."))
# Large: ascending pushes are the worst case for sift up; then drain half.
ops = [P(v) for v in range(-1500, 1500, 2)] + [x for _ in range(800) for x in (PO,)] + [SZ, T]
tests.append(case("h-large-push-pop", True, ops, "1500 ascending pushes (each sifts to the root), then 800 pops."))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
