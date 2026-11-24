"""Regenerates tests.json deterministically from the Python reference solution.

Cross-checked against brute force (remove each edge, test connectivity) on small graphs.
"""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


def connected(n, edges):
    adj = [[] for _ in range(n)]
    for a, b in edges:
        adj[a].append(b); adj[b].append(a)
    seen = {0}; stack = [0]
    while stack:
        u = stack.pop()
        for v in adj[u]:
            if v not in seen:
                seen.add(v); stack.append(v)
    return len(seen) == n


def brute(n, edges):
    return [e for i, e in enumerate(edges) if not connected(n, edges[:i] + edges[i + 1:])]


def norm(es):
    return sorted(tuple(sorted(e)) for e in es)


def case(id, hidden, n, edges, explanation=None):
    got = mod.Solution().criticalConnections(n, [list(e) for e in edges])
    if len(edges) <= 300:
        assert norm(got) == norm(brute(n, edges)), id
    t = {"id": id, "hidden": hidden, "ctorArgs": [],
         "calls": [{"method": "criticalConnections", "args": [n, edges]}], "expected": [got]}
    if explanation: t["explanation"] = explanation
    return t


def rand_connected(rng, n, extra):
    perm = list(range(n)); rng.shuffle(perm)
    edges = set()
    for i in range(1, n):
        a, b = perm[i], perm[rng.randrange(i)]
        edges.add((min(a, b), max(a, b)))
    while len(edges) < n - 1 + extra:
        a, b = rng.sample(range(n), 2)
        edges.add((min(a, b), max(a, b)))
    out = [[a, b] if rng.random() < 0.5 else [b, a] for a, b in edges]
    out.sort(); rng.shuffle(out)
    return out


rng = random.Random(1192)
for _ in range(400):
    n = rng.randint(2, 9)
    extra = rng.randint(0, min(6, n * (n - 1) // 2 - (n - 1)))
    e = rand_connected(rng, n, extra)
    assert norm(mod.Solution().criticalConnections(n, e)) == norm(brute(n, e))

tests = [
    case("s1", False, 5, [[0, 1], [1, 2], [2, 0], [1, 3], [3, 4]], "The triangle 0-1-2 is safe; 1-3 and 3-4 are not."),
    case("s2", False, 2, [[0, 1]], "A single cable is always critical."),
    case("s3", False, 4, [[0, 1], [1, 2], [2, 3], [3, 0]], "Every cable lies on the 4-cycle."),
    case("h-path", True, 5, [[3, 4], [0, 1], [2, 3], [1, 2]], "A path: every cable is critical."),
    case("h-star", True, 6, [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5]]),
    case("h-two-cycles-bridge", True, 6, [[0, 1], [1, 2], [2, 0], [3, 4], [4, 5], [5, 3], [2, 3]],
         "Only the cable joining the two triangles is critical."),
    case("h-articulation-not-bridge", True, 5, [[0, 1], [1, 2], [2, 0], [2, 3], [3, 4], [4, 2]],
         "Server 2 is a cut vertex but no cable is critical (>= vs > matters)."),
    case("h-complete-5", True, 5, [[a, b] for a in range(5) for b in range(a + 1, 5)]),
]
for k, (n, extra) in enumerate([(8, 2), (15, 4), (30, 5), (50, 10), (100, 8), (150, 40), (200, 3)]):
    tests.append(case(f"h-rand-{k}", True, n, rand_connected(rng, n, extra)))

# Long path with small cycles hanging off: deep DFS (recursion limit) and many bridges.
n = 7000
edges = [[i, i + 1] for i in range(n // 2 - 1)]
for i in range(n // 2, n, 2):
    host = rng.randrange(n // 2)
    edges += [[host, i], [i, i + 1], [i + 1, host]] if i + 1 < n else [[host, i]]
rng.shuffle(edges)
tests.append(case("h-deep-path", True, n, edges))
# Large random sparse connected graph: many bridges in the tree-like parts.
tests.append(case("h-large-sparse", True, 5000, rand_connected(rng, 5000, 1000)))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
