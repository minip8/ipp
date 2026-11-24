"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def valid_starts(gas, cost):
    """O(n) via prefix sums: s is valid iff every partial sum from s around the circle stays >= 0."""
    n = len(gas); d = [g - c for g, c in zip(gas, cost)]
    if sum(d) < 0: return []
    pre = [0]
    for x in d + d: pre.append(pre[-1] + x)
    # s valid iff min(pre[s+1..s+n]) - pre[s] >= 0; use a sliding-window minimum
    from collections import deque
    out, dq = [], deque()
    for j in range(1, 2 * n + 1):
        while dq and pre[dq[-1]] >= pre[j]: dq.pop()
        dq.append(j)
        s = j - n
        if 0 <= s < n:
            while dq[0] <= s: dq.popleft()
            if pre[dq[0]] - pre[s] >= 0: out.append(s)
    return out

def brute(gas, cost):
    n = len(gas); res = []
    for s in range(n):
        t = 0
        for k in range(n):
            i = (s + k) % n; t += gas[i] - cost[i]
            if t < 0: break
        else: res.append(s)
    return res

def case(id, hidden, gas, cost, explanation=None):
    v = valid_starts(gas, cost)
    assert len(v) <= 1, "answer must be unique"
    exp = v[0] if v else -1
    assert mod.Solution().canCompleteCircuit(list(gas), list(cost)) == exp
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "canCompleteCircuit", "args": [gas, cost]}], "expected": [exp]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(134)
for _ in range(3000):
    n = rng.randint(1, 7)
    g = [rng.randint(0, 5) for _ in range(n)]; c = [rng.randint(0, 5) for _ in range(n)]
    assert valid_starts(g, c) == brute(g, c)
    v = brute(g, c)
    if len(v) <= 1: assert mod.Solution().canCompleteCircuit(g, c) == (v[0] if v else -1)

def unique_instance(n, hi, solvable=True):
    """Random instance with exactly one valid start (or none)."""
    while True:
        g = [rng.randint(0, hi) for _ in range(n)]; c = [rng.randint(0, hi) for _ in range(n)]
        diff = sum(g) - sum(c)
        if solvable:
            # make total exactly 0: then the start after the unique strict minimum prefix is the only answer
            i = rng.randrange(n)
            if diff > 0: c[i] += diff
            else: g[i] -= diff
            if max(g + c) > 10**4: continue
        elif diff >= 0:
            continue
        if len(valid_starts(g, c)) == (1 if solvable else 0):
            return g, c

tests = [
    case("s1", False, [1, 2, 3, 4, 5], [3, 4, 5, 1, 2]),
    case("s2", False, [2, 3, 4], [3, 4, 3], "Total gas 9 is less than total cost 10."),
    case("s3", False, [5], [5]),
    case("h-single-fail", True, [4], [5]),
    case("h-zeros-single", True, [0], [0]),
    case("h-start-last", True, [0, 0, 0, 9], [3, 3, 3, 0]),
    case("h-start-first", True, [9, 0, 0, 0], [0, 3, 3, 3]),
    case("h-deficit-by-one", True, [3, 3, 3], [3, 3, 4]),
    case("h-reset-twice", True, [1, 0, 2, 0, 6], [2, 1, 3, 1, 2]),
]
for k, n in enumerate([5, 50, 500, 2000]):
    tests.append(case(f"h-rand-{k}", True, *unique_instance(n, 100)))
tests.append(case("h-rand-none", True, *unique_instance(300, 100, solvable=False)))
tests.append(case("h-large", True, *unique_instance(12000, 10000)))
tests.append(case("h-large-none", True, *unique_instance(20000, 50, solvable=False)))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
