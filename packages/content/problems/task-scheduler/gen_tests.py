"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib, heapq
from collections import Counter, deque

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def simulate(tasks, n):
    """Independent check: each unit run the available task with the most remaining copies."""
    heap = [-c for c in Counter(tasks).values()]; heapq.heapify(heap)
    cool = deque(); t = 0
    while heap or cool:
        t += 1
        if heap:
            c = heapq.heappop(heap) + 1
            if c: cool.append((t + n, c))
        if cool and cool[0][0] == t:
            heapq.heappush(heap, cool.popleft()[1])
    return t

def case(id, hidden, tasks, n, explanation=None):
    exp = mod.Solution().leastInterval(list(tasks), n)
    assert exp == simulate(tasks, n)
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "leastInterval", "args": [list(tasks), n]}], "expected": [exp]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(621)
for _ in range(3000):
    tasks = [rng.choice("ABCD") for _ in range(rng.randint(1, 10))]
    n = rng.randint(0, 4)
    assert mod.Solution().leastInterval(tasks, n) == simulate(tasks, n)

def gen(size, letters, skew=1.0):
    pool = [chr(65 + i) for i in range(letters)]
    weights = [skew ** i for i in range(letters)]
    return rng.choices(pool, weights, k=size)

tests = [
    case("s1", False, "AAABBB", 2, "A B idle A B idle A B"),
    case("s2", False, "ACABDB", 1, "Enough variety that the CPU never idles."),
    case("s3", False, "AAABBB", 0),
    case("s4", False, "AAAABC", 3, "Three idle gaps of 3 after each A, partly filled by B and C."),
    case("h-single", True, "Z", 100),
    case("h-one-label", True, "AAAAA", 4, "(5 - 1) * 5 + 1 = 21"),
    case("h-ties-for-max", True, "AAABBBCCCDD", 2, "Three labels tie for the max count."),
    case("h-many-labels", True, "ABCDEFGHIJKLMNOPQRSTUVWXYZ" * 2, 25),
    case("h-gaps-overflow", True, "AABBCCDDEEFF", 1, "More tasks than gaps: no idling at all."),
    case("h-big-n", True, "AABC", 100),
]
for k, (size, letters, nn, skew) in enumerate([(20, 4, 2, 1.0), (200, 10, 5, 0.8), (1000, 26, 30, 0.9), (2000, 3, 7, 1.0)]):
    tests.append(case(f"h-rand-{k}", True, gen(size, letters, skew), nn))
tests.append(case("h-large-skewed", True, gen(10000, 26, 0.5), 100))
tests.append(case("h-large-uniform", True, gen(10000, 26), 20))
tests.append(case("h-large-one-label", True, ["Q"] * 10000, 100, "9999 * 101 + 1 = 1009900 units."))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
