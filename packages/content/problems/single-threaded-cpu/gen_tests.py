"""Regenerates tests.json deterministically from the Python reference solution.

An O(n^2) direct simulation of the rules is checked against the reference on small random inputs.
"""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


def brute(tasks):
    remaining = set(range(len(tasks)))
    clock, out = 0, []
    while remaining:
        avail = [i for i in remaining if tasks[i][0] <= clock]
        if not avail:
            clock = min(tasks[i][0] for i in remaining)
            continue
        i = min(avail, key=lambda i: (tasks[i][1], i))
        out.append(i); remaining.remove(i); clock += tasks[i][1]
    return out


def solve(tasks):
    return mod.Solution().getOrder([list(t) for t in tasks])


def case(id, hidden, tasks, explanation=None):
    t = {"id": id, "hidden": hidden, "ctorArgs": [],
         "calls": [{"method": "getOrder", "args": [tasks]}], "expected": [solve(tasks)]}
    if explanation: t["explanation"] = explanation
    return t


def rand_tasks(rng, n, tmax, pmax):
    return [[rng.randint(1, tmax), rng.randint(1, pmax)] for _ in range(n)]


rng = random.Random(1834)
for _ in range(600):
    tk = rand_tasks(rng, rng.randint(1, 10), rng.choice([3, 10, 30]), rng.choice([2, 5, 10]))
    assert solve(tk) == brute(tk)

tests = [
    case("s1", False, [[1, 3], [2, 1], [3, 2], [4, 1]],
         "At time 4 tasks 1 and 3 tie on processing time; index 1 goes first."),
    case("s2", False, [[5, 2], [5, 2], [5, 1], [20, 3]], "The CPU is idle from 10 to 20."),
    case("h-single", True, [[1000000000, 1000000000]]),
    case("h-all-same", True, [[3, 4]] * 6, "Identical tasks run in index order."),
    case("h-arrives-at-finish", True, [[1, 2], [3, 5], [3, 1], [4, 1]],
         "Tasks 1 and 2 arrive exactly when task 0 finishes at 3."),
    case("h-short-arrives-late", True, [[1, 10], [2, 9], [3, 1], [11, 1]],
         "A short task arriving while the CPU is busy does not preempt."),
    case("h-not-by-arrival", True, [[7, 1], [1, 5], [2, 1], [2, 3]], "Input is not sorted by enqueue time."),
    case("h-big-times", True, [[1000000000, 1000000000]] * 3 + [[1, 1000000000]] * 3,
         "The clock passes 2^31; 32-bit arithmetic overflows."),
    case("h-gaps", True, [[1, 1], [100, 1], [50, 1], [1000, 2], [999, 3]]),
]
for k, (n, t, p) in enumerate([(8, 10, 5), (20, 50, 10), (100, 200, 20), (500, 10**4, 100), (1000, 10**9, 10**9)]):
    tests.append(case(f"h-rand-{k}", True, rand_tasks(rng, n, t, p)))
tests.append(case("h-large-busy", True, rand_tasks(rng, 6000, 1000, 1000),
                  "All tasks arrive early: the available set grows to thousands."))
tests.append(case("h-large-sparse", True, rand_tasks(rng, 4000, 10**9, 10)))
tests.append(case("h-large-ties", True, rand_tasks(rng, 6000, 50, 3), "Lots of ties on processing time."))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
