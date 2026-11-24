"""Regenerates tests.json deterministically from the Python reference solution.

Cross-checked against a brute-force cycle test (transitive closure) on small random graphs.
"""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


def brute(n, pre):
    reach = [[False] * n for _ in range(n)]
    for a, b in pre:
        reach[b][a] = True
    for k in range(n):
        for i in range(n):
            if reach[i][k]:
                for j in range(n):
                    if reach[k][j]:
                        reach[i][j] = True
    return not any(reach[i][i] for i in range(n))


def case(id, hidden, n, pre, explanation=None):
    got = mod.Solution().canFinish(n, [list(p) for p in pre])
    if n <= 60:
        assert got == brute(n, pre), id
    t = {"id": id, "hidden": hidden, "ctorArgs": [],
         "calls": [{"method": "canFinish", "args": [n, pre]}], "expected": [got]}
    if explanation: t["explanation"] = explanation
    return t


def rand_dag(rng, n, m):
    order = list(range(n)); rng.shuffle(order)
    pre = []
    for _ in range(m):
        i, j = sorted(rng.sample(range(n), 2))
        pre.append([order[j], order[i]])  # order[i] before order[j]
    return pre, order


rng = random.Random(207)
for _ in range(400):
    n = rng.randint(1, 9)
    pre = [[rng.randrange(n), rng.randrange(n)] for _ in range(rng.randint(0, 10))]
    assert mod.Solution().canFinish(n, pre) == brute(n, pre)

tests = [
    case("s1", False, 3, [[1, 0], [2, 1]], "Take 0, then 1, then 2."),
    case("s2", False, 2, [[1, 0], [0, 1]], "Each course needs the other first."),
    case("s3", False, 4, [[1, 0], [2, 1], [3, 2], [1, 3]], "1 -> 2 -> 3 -> 1 is a cycle."),
    case("h-no-prereqs", True, 5, []),
    case("h-self-loop", True, 3, [[0, 1], [2, 2]], "Course 2 requires itself."),
    case("h-diamond", True, 4, [[1, 0], [2, 0], [3, 1], [3, 2]],
         "Two paths to course 3 are not a cycle (breaks two-colour DFS)."),
    case("h-duplicates", True, 3, [[1, 0], [1, 0], [2, 1], [2, 1]]),
    case("h-disconnected-cycle", True, 7, [[1, 0], [2, 1], [4, 3], [5, 4], [3, 5]]),
]
for k in range(6):
    n = rng.randint(5, 50)
    pre, _ = rand_dag(rng, n, rng.randint(n, 3 * n))
    tests.append(case(f"h-rand-dag-{k}", True, n, pre))
for k in range(4):
    n = rng.randint(5, 50)
    pre, order = rand_dag(rng, n, rng.randint(n, 3 * n))
    i, j = sorted(rng.sample(range(n), 2))
    pre.append([order[i], order[j]])  # a single back edge creates a cycle if order[i] reaches order[j]
    pre.insert(rng.randrange(len(pre)), [order[i], order[i]] if k == 3 else [order[j], order[i]])
    tests.append(case(f"h-rand-mixed-{k}", True, n, pre))

# Long chain: 0 -> 1 -> ... -> n-1, recursion depth 7000 for naive recursive DFS.
n = 7000
perm = list(range(n)); rng.shuffle(perm)
chain = [[perm[i + 1], perm[i]] for i in range(n - 1)]; rng.shuffle(chain)
tests.append(case("h-long-chain", True, n, chain))
tests.append(case("h-long-cycle", True, n, chain + [[perm[0], perm[-1]]]))
# Layered diamonds: exponential paths, fine for DFS with memo, fatal without it.
layers, width = 350, 4
pre = []
for L in range(layers - 1):
    for a in range(width):
        for b in range(width):
            pre.append([(L + 1) * width + b, L * width + a])
tests.append(case("h-layered", True, layers * width, pre))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
