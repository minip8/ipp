"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib, copy

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def merge(iv):
    out = []
    for s, e in sorted(iv):
        if out and s <= out[-1][1]: out[-1][1] = max(out[-1][1], e)
        else: out.append([s, e])
    return out

def case(id, hidden, iv, new, explanation=None):
    assert all(iv[i][1] < iv[i + 1][0] for i in range(len(iv) - 1))
    exp = merge(copy.deepcopy(iv) + [list(new)])
    assert mod.Solution().insert(copy.deepcopy(iv), list(new)) == exp
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "insert", "args": [iv, new]}], "expected": [exp]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(57)
def disjoint(n, gap, maxlen):
    t, out = rng.randint(0, gap), []
    for _ in range(n):
        s = t; e = s + rng.randint(0, maxlen); out.append([s, e]); t = e + 1 + rng.randint(0, gap)
    return out
for _ in range(3000):
    iv = disjoint(rng.randint(0, 5), 3, 3)
    a = rng.randint(0, 30); new = [a, a + rng.randint(0, 6)]
    assert mod.Solution().insert(copy.deepcopy(iv), new) == merge(iv + [new])

tests = [
    case("s1", False, [[1, 2], [5, 7], [9, 12]], [3, 4], "Fits in a gap; nothing merges."),
    case("s2", False, [[1, 2], [5, 7], [9, 12]], [6, 9], "Overlaps [5, 7] and touches [9, 12]."),
    case("s3", False, [], [4, 8]),
    case("s4", False, [[1, 3], [6, 9]], [3, 6], "Touches both neighbours."),
    case("h-before-all", True, [[5, 6], [8, 9]], [0, 1]),
    case("h-after-all", True, [[5, 6], [8, 9]], [20, 30]),
    case("h-swallow-all", True, [[2, 3], [5, 6], [8, 9]], [0, 100]),
    case("h-inside-one", True, [[1, 10]], [3, 4]),
    case("h-point", True, [[1, 2], [4, 5]], [3, 3]),
    case("h-touch-left-end", True, [[1, 2], [6, 8]], [8, 9]),
    case("h-touch-right-start", True, [[1, 2], [6, 8]], [4, 6]),
    case("h-gap-one", True, [[1, 2], [6, 8]], [3, 5], "3 is next to 2 and 5 next to 6, but nothing touches."),
]
for k, n in enumerate([5, 50, 300, 1000]):
    iv = disjoint(n, 20, 10)
    a = rng.randint(0, iv[-1][1]); tests.append(case(f"h-rand-{k}", True, iv, [a, a + rng.randint(0, 200)]))
big = disjoint(3000, 50, 40)
tests.append(case("h-large-middle", True, big, [big[1000][0] + 1, big[2000][1]]))
tests.append(case("h-large-end", True, big, [big[-1][1] + 2, big[-1][1] + 3]))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
