"""Regenerates tests.json deterministically from the Python reference solution.

Cross-checked against brute force (first valid permutation in lexicographic order) for small n.
Also asserts that several hidden tests are ones where plain FIFO Kahn gives a different order.
"""
import json, random, importlib.util, pathlib, itertools
from collections import deque

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


def brute(n, pre):
    for perm in itertools.permutations(range(n)):
        pos = {c: i for i, c in enumerate(perm)}
        if all(pos[b] < pos[a] for a, b in pre):
            return list(perm)
    return []


def fifo_kahn(n, pre):
    out = [[] for _ in range(n)]; indeg = [0] * n
    for a, b in pre:
        out[b].append(a); indeg[a] += 1
    q = deque(i for i in range(n) if indeg[i] == 0); order = []
    while q:
        u = q.popleft(); order.append(u)
        for v in out[u]:
            indeg[v] -= 1
            if indeg[v] == 0: q.append(v)
    return order if len(order) == n else []


def case(id, hidden, n, pre, explanation=None, fifo_differs=False):
    got = mod.Solution().findOrder(n, [list(p) for p in pre])
    if n <= 7:
        assert got == brute(n, pre), id
    if fifo_differs:
        assert fifo_kahn(n, pre) != got, id
    t = {"id": id, "hidden": hidden, "ctorArgs": [],
         "calls": [{"method": "findOrder", "args": [n, pre]}], "expected": [got]}
    if explanation: t["explanation"] = explanation
    return t


def rand_dag(rng, n, m):
    order = list(range(n)); rng.shuffle(order)
    pre = []
    for _ in range(m):
        i, j = sorted(rng.sample(range(n), 2))
        pre.append([order[j], order[i]])
    return pre, order


rng = random.Random(210)
for _ in range(500):
    n = rng.randint(1, 6)
    if rng.random() < 0.7:
        pre, _ = rand_dag(rng, n, rng.randint(0, 8)) if n > 1 else ([], None)
    else:
        pre = [[rng.randrange(n), rng.randrange(n)] for _ in range(rng.randint(0, 6))]
    assert mod.Solution().findOrder(n, pre) == brute(n, pre)

tests = [
    case("s1", False, 4, [[1, 0], [2, 0], [3, 1], [3, 2]], "Only 0 is available first; then 1 beats 2; then 3."),
    case("s2", False, 4, [[0, 3], [1, 3]], "2 and 3 are available at the start; 2 is smaller."),
    case("s3", False, 2, [[0, 1], [1, 0]], "A cycle: no plan exists."),
    case("h-dfs-trap", True, 3, [[0, 2]], "Expected [1,2,0]; reverse DFS post-order gives [2,1,0].", fifo_differs=False),
    case("h-fifo-trap", True, 5, [[1, 4], [2, 4], [0, 3]],
         "FIFO Kahn takes 3, 4 then 0, 1, 2 in arrival order; the heap version takes 0 as soon as 3 is done.",
         fifo_differs=True),
    case("h-no-prereqs", True, 6, []),
    case("h-self-loop", True, 3, [[1, 0], [2, 2]]),
    case("h-duplicates", True, 4, [[3, 0], [3, 0], [1, 3], [1, 3], [2, 1]]),
    case("h-reverse-chain", True, 6, [[i, i + 1] for i in range(5)], "Course 5 first, then 4, ... , 0."),
    case("h-cycle-unreachable-part", True, 6, [[1, 0], [3, 2], [4, 3], [2, 4], [5, 1]]),
]
k = 0
while k < 8:
    n = rng.randint(8, 40)
    pre, _ = rand_dag(rng, n, rng.randint(n // 2, 2 * n))
    if fifo_kahn(n, pre) != mod.Solution().findOrder(n, pre):
        tests.append(case(f"h-rand-{k}", True, n, pre, fifo_differs=True))
        k += 1
for k in range(2):
    n = rng.randint(8, 40)
    pre, order = rand_dag(rng, n, rng.randint(n, 2 * n))
    pre.append([order[0], order[-1]] if k == 0 else [order[3], order[5]])
    tests.append(case(f"h-rand-maybe-cycle-{k}", True, n, pre))

# Large: wide random DAG. An O(V^2) "scan for smallest available" is too slow here.
n = 12000
pre, _ = rand_dag(rng, n, 5000)
tests.append(case("h-large-sparse", True, n, pre, fifo_differs=True))
# Large: reversed labels on a chain with many free courses mixed in.
n = 8000
chain_nodes = list(range(n - 1, n // 2 - 1, -1))
pre = [[chain_nodes[i + 1], chain_nodes[i]] for i in range(len(chain_nodes) - 1)]
tests.append(case("h-large-chain-plus-free", True, n, pre))
# Large cycle buried at the end.
n = 6000
pre, order = rand_dag(rng, n, 2500)
pre.append([order[100], order[5500]])
pre.append([order[5500], order[100]])
tests.append(case("h-large-cycle", True, n, pre))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
