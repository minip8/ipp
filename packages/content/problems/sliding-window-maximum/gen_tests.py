"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def brute(a, k):
    return [max(a[i:i + k]) for i in range(len(a) - k + 1)]

def blocks(a, k):
    n = len(a); pre = a[:]; suf = a[:]
    for i in range(n):
        if i % k: pre[i] = max(pre[i - 1], a[i])
    for i in range(n - 2, -1, -1):
        if (i + 1) % k: suf[i] = max(suf[i + 1], a[i])
    return [max(suf[i], pre[i + k - 1]) for i in range(n - k + 1)]

def case(id, hidden, a, k, explanation=None):
    exp = mod.Solution().maxSlidingWindow(list(a), k)
    assert exp == blocks(a, k)
    if len(a) * k <= 10**6: assert exp == brute(a, k)
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "maxSlidingWindow", "args": [a, k]}], "expected": [exp]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(239)
for _ in range(3000):
    a = [rng.randint(-3, 3) for _ in range(rng.randint(1, 10))]
    k = rng.randint(1, len(a))
    assert mod.Solution().maxSlidingWindow(a, k) == brute(a, k)

tests = [
    case("s1", False, [4, 2, 12, 3, 8, 1, 7], 3),
    case("s2", False, [9, 8, 7, 6], 2),
    case("s3", False, [5], 1),
    case("h-k1", True, [3, -1, 2, -5], 1, "Every element is its own window."),
    case("h-k-equals-n", True, [3, -1, 2, -5], 4),
    case("h-increasing", True, list(range(10)), 3),
    case("h-decreasing", True, list(range(10, 0, -1)), 4, "The front expires at every step."),
    case("h-duplicates", True, [2, 2, 2, 1, 2, 2], 3),
    case("h-negatives", True, [-7, -8, -3, -9, -10000], 2),
]
for k_, (n, k) in enumerate([(20, 5), (200, 17), (2000, 100), (3000, 2999)]):
    tests.append(case(f"h-rand-{k_}", True, [rng.randint(-10**4, 10**4) for _ in range(n)], k))
big = [rng.randint(-10**4, 10**4) for _ in range(16000)]
tests.append(case("h-large-half", True, big, 8000, "O(n * k) is ~6 * 10^7 here."))
desc = list(range(10**4, 0, -1))
tests.append(case("h-large-decreasing", True, desc, 4000, "Strictly decreasing: brute force scans every window fully."))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
