"""Regenerates tests.json deterministically from the Python reference solution.

A BFS-based brute force is checked against the reference on small random graphs first.
"""
import json, random, importlib.util, pathlib
from collections import deque

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


def brute(n, edges):
    adj = [[] for _ in range(n)]
    for a, b in edges:
        adj[a].append(b); adj[b].append(a)
    seen, count = [False] * n, 0
    for s in range(n):
        if seen[s]:
            continue
        count += 1
        seen[s] = True
        q = deque([s])
        while q:
            u = q.popleft()
            for v in adj[u]:
                if not seen[v]:
                    seen[v] = True; q.append(v)
    return count


def solve(n, edges):
    return mod.Solution().countComponents(n, [list(e) for e in edges])


def case(id, hidden, n, edges, explanation=None):
    t = {"id": id, "hidden": hidden, "ctorArgs": [],
         "calls": [{"method": "countComponents", "args": [n, edges]}], "expected": [solve(n, edges)]}
    if explanation: t["explanation"] = explanation
    return t


def random_graph(rng, n, m):
    edges = []
    for _ in range(m):
        a, b = rng.sample(range(n), 2)
        edges.append([a, b])
    return edges


rng = random.Random(323)
for _ in range(400):
    n = rng.randint(1, 12)
    m = rng.randint(0, 15) if n > 1 else 0
    e = random_graph(rng, n, m) if n > 1 else []
    assert solve(n, e) == brute(n, e)

tests = [
    case("s1", False, 6, [[0, 1], [1, 2], [4, 5]], "Components {0,1,2}, {3} and {4,5}."),
    case("s2", False, 4, [[0, 1], [2, 3], [1, 2], [3, 0]], "All four nodes are connected (the last edge closes a cycle)."),
    case("s3", False, 3, [], "No edges: every node is its own component."),
    case("h-single", True, 1, []),
    case("h-duplicates", True, 4, [[0, 1], [1, 0], [0, 1], [2, 3], [3, 2]], "Duplicate edges must not be counted twice."),
    case("h-cycle-plus-isolated", True, 7, [[0, 1], [1, 2], [2, 0], [3, 4], [4, 5], [5, 3]]),
    case("h-star", True, 8, [[0, i] for i in range(1, 8)]),
]
for k, (n, m) in enumerate([(10, 5), (20, 12), (50, 40), (200, 150), (1000, 700), (1000, 1500)]):
    tests.append(case(f"h-rand-{k}", True, n, random_graph(rng, n, m)))
# A long path in shuffled order: deep recursion / naive union-find chains.
n = 9000
perm = list(range(n)); rng.shuffle(perm)
path = [[perm[i], perm[i + 1]] for i in range(n - 1)]
rng.shuffle(path)
tests.append(case("h-long-path", True, n, path, "One path through 9000 nodes."))
# Ordered chain that degrades union-find without balancing: union (i, i+1) for increasing i.
n = 6000
tests.append(case("h-chain-ordered", True, n, [[i, i + 1] for i in range(n - 1)] + [[n - 1, 0]]))
# Many small components with lots of redundant edges.
n = 3000
edges = []
for _ in range(4000):
    g = rng.randrange(n // 10)
    a, b = rng.sample(range(g * 10, g * 10 + 10), 2)
    edges.append([a, b])
tests.append(case("h-many-groups", True, n, edges))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
