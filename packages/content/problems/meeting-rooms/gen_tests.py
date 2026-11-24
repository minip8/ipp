"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib, copy

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def brute(iv):
    return not any(a[0] < b[1] and b[0] < a[1] for i, a in enumerate(iv) for b in iv[i + 1:])

def case(id, hidden, iv, explanation=None):
    exp = brute(iv)
    assert mod.Solution().canAttendMeetings(copy.deepcopy(iv)) == exp
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "canAttendMeetings", "args": [iv]}], "expected": [exp]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(252)
for _ in range(3000):
    iv = []
    for _ in range(rng.randint(0, 5)):
        a = rng.randint(0, 10); iv.append([a, a + rng.randint(1, 4)])
    assert mod.Solution().canAttendMeetings(copy.deepcopy(iv)) == brute(iv)

def disjoint(n, maxgap=50):
    t, out = 0, []
    for _ in range(n):
        t += rng.randint(0, maxgap); e = t + rng.randint(1, 50); out.append([t, e]); t = e
    rng.shuffle(out)
    return out

tests = [
    case("s1", False, [[9, 10], [13, 15], [10, 12]], "Back-to-back meetings at time 10 do not overlap."),
    case("s2", False, [[1, 5], [8, 9], [4, 6]], "[1, 5] and [4, 6] overlap between 4 and 5."),
    case("s3", False, []),
    case("h-single", True, [[0, 1000000]]),
    case("h-contained", True, [[1, 10], [3, 4]]),
    case("h-same-start", True, [[5, 6], [5, 9]]),
    case("h-touch-chain", True, [[3, 4], [1, 2], [2, 3], [4, 5]]),
    case("h-overlap-by-one", True, [[0, 5], [10, 20], [4, 9]]),
    case("h-identical", True, [[2, 3], [2, 3]]),
    case("h-nonadjacent-after-sort", True, [[1, 100], [2, 3], [50, 60]], "Sorted by start, [1,100] overlaps the next meeting."),
]
for k, n in enumerate([5, 20, 100, 1000]):
    d = disjoint(n)
    tests.append(case(f"h-rand-ok-{k}", True, d))
    bad = copy.deepcopy(d); i = rng.randrange(n); bad[i][1] += 60 + 50 + 1  # guaranteed to hit the next meeting
    bad.append([max(0, bad[i][0]), bad[i][0] + 1]) if n == 5 else None
    tests.append(case(f"h-rand-bad-{k}", True, bad))
tests.append(case("h-large-ok", True, disjoint(6000, 40)))
lb = disjoint(6000, 40); lb.append([lb[0][0], lb[0][0] + 1])
tests.append(case("h-large-one-clash", True, lb))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
