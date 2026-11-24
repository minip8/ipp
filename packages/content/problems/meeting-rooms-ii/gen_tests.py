"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib, copy, heapq

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def brute(iv):
    return max(sum(1 for s, e in iv if s <= t < e) for t, _ in iv)

def heap_version(iv):
    h = []
    for s, e in sorted(iv):
        if h and h[0] <= s: heapq.heapreplace(h, e)
        else: heapq.heappush(h, e)
    return len(h)

def case(id, hidden, iv, explanation=None):
    exp = mod.Solution().minMeetingRooms(copy.deepcopy(iv))
    assert exp == heap_version(iv)
    if len(iv) <= 1500: assert exp == brute(iv)
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "minMeetingRooms", "args": [iv]}], "expected": [exp]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(253)
def gen(n, span, maxlen):
    out = []
    for _ in range(n):
        s = rng.randint(0, span - 1); out.append([s, min(span, s + rng.randint(1, maxlen))])
    return out
for _ in range(3000):
    iv = gen(rng.randint(1, 7), 12, 5)
    assert mod.Solution().minMeetingRooms(iv) == brute(iv)

tests = [
    case("s1", False, [[0, 30], [5, 10], [15, 20]]),
    case("s2", False, [[7, 10], [2, 4]]),
    case("s3", False, [[1, 5], [5, 9], [2, 6], [6, 8]], "Rooms freed at 5 and 6 are reused immediately."),
    case("h-single", True, [[0, 1000000]]),
    case("h-all-same", True, [[1, 2]] * 5),
    case("h-back-to-back", True, [[3, 4], [1, 2], [2, 3], [4, 5]], "Process ends before starts at equal times."),
    case("h-nested", True, [[1, 10], [2, 9], [3, 8], [4, 7]]),
    case("h-staircase", True, [[i, i + 3] for i in range(10)]),
    case("h-adjacent-not-previous", True, [[1, 10], [2, 3], [4, 5], [6, 7]], "Each short meeting overlaps only the long one."),
]
for k, (n, span, ml) in enumerate([(10, 50, 10), (100, 1000, 100), (1000, 10**6, 5000), (1500, 2000, 30)]):
    tests.append(case(f"h-rand-{k}", True, gen(n, span, ml)))
tests.append(case("h-large", True, gen(10000, 10**6, 2000)))
tests.append(case("h-large-all-overlap", True, [[rng.randint(0, 1000), rng.randint(500001, 10**6)] for _ in range(5000)]))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
