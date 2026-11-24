"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib, copy, bisect

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def brute(iv):
    """O(n^2) DP: longest chain of non-conflicting intervals sorted by end."""
    s = sorted(iv, key=lambda x: (x[1], x[0]))
    best = [1] * len(s)
    for i in range(len(s)):
        for j in range(i):
            if s[j][1] <= s[i][0]: best[i] = max(best[i], best[j] + 1)
    return len(iv) - max(best)

def case(id, hidden, iv, explanation=None):
    exp = mod.Solution().eraseOverlapIntervals(copy.deepcopy(iv))
    if len(iv) <= 1500: assert exp == brute(iv)
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "eraseOverlapIntervals", "args": [iv]}], "expected": [exp]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(435)
def gen(n, lo, hi, maxlen):
    out = []
    for _ in range(n):
        s = rng.randint(lo, hi - 1); out.append([s, min(hi, s + rng.randint(1, maxlen))])
    return out
for _ in range(3000):
    iv = gen(rng.randint(1, 7), 0, 12, 5)
    assert mod.Solution().eraseOverlapIntervals(iv) == brute(iv)

tests = [
    case("s1", False, [[1, 3], [2, 4], [3, 5], [1, 5]], "Keep [1, 3] and [3, 5]; remove the other two."),
    case("s2", False, [[1, 2], [1, 2], [1, 2]]),
    case("s3", False, [[1, 2], [2, 3]], "Touching bookings don't conflict."),
    case("h-single", True, [[-50000, 50000]]),
    case("h-long-first", True, [[1, 100], [2, 3], [4, 5], [6, 7]], "Keeping the earliest-starting interval is wrong."),
    case("h-shortest-trap", True, [[1, 5], [4, 7], [6, 10]], "The shortest interval conflicts with both others."),
    case("h-nested", True, [[1, 10], [2, 9], [3, 8], [4, 7]]),
    case("h-negatives", True, [[-5, -1], [-3, 2], [-1, 0], [0, 3]]),
    case("h-chain-touching", True, [[3, 4], [1, 2], [2, 3], [4, 5]]),
]
for k, (n, ml) in enumerate([(10, 10), (100, 50), (1000, 300), (1500, 30)]):
    tests.append(case(f"h-rand-{k}", True, gen(n, -50000, 50000, ml)))
tests.append(case("h-large", True, gen(7000, -50000, 50000, 100)))
tests.append(case("h-large-dense", True, gen(5000, -1000, 1000, 50)))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
