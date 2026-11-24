"""Regenerates tests.json deterministically from the Python reference solution.

The reference is cross-checked against a brute-force reachability closure on small random graphs.
"""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


def brute(n, edges, s, d):
    reach = {s}
    changed = True
    while changed:
        changed = False
        for u, v in edges:
            if (u in reach) != (v in reach):
                reach |= {u, v}
                changed = True
    return d in reach


def case(id, hidden, n, edges, s, d, explanation=None):
    t = {"id": id, "hidden": hidden, "ctorArgs": [],
         "calls": [{"method": "validPath", "args": [n, edges, s, d]}],
         "expected": [mod.Solution().validPath(n, [list(e) for e in edges], s, d)]}
    if explanation: t["explanation"] = explanation
    return t


def rand_graph(rng, n, m):
    return [[rng.randrange(n), rng.randrange(n)] for _ in range(m)]


rng = random.Random(1971)
for _ in range(500):
    n = rng.randint(1, 12)
    e = rand_graph(rng, n, rng.randint(0, 12))
    s, d = rng.randrange(n), rng.randrange(n)
    assert mod.Solution().validPath(n, e, s, d) == brute(n, e, s, d)

tests = [
    case("s1", False, 4, [[0, 1], [1, 2], [3, 3]], 0, 2, "0 - 1 - 2 connects the two vertices."),
    case("s2", False, 5, [[0, 1], [2, 3], [3, 4]], 1, 4, "Vertex 1 is in {0, 1}; vertex 4 is in {2, 3, 4}."),
    case("s3", False, 1, [], 0, 0, "Every vertex reaches itself."),
    case("h-undirected", True, 3, [[2, 1], [1, 0]], 0, 2, "Edges are listed 'backwards'; they are undirected."),
    case("h-isolated-target", True, 4, [[0, 1], [1, 2], [2, 0]], 0, 3),
    case("h-self-loops-dups", True, 3, [[0, 0], [1, 1], [0, 0], [2, 2]], 0, 2),
    case("h-same-no-edges", True, 6, [], 4, 4),
    case("h-cycle-then-bridge", True, 6, [[0, 1], [1, 2], [2, 0], [2, 3], [3, 4], [4, 3], [5, 5]], 0, 4),
]
for k in range(10):
    n = rng.randint(5, 60)
    m = rng.randint(0, n)
    e = rand_graph(rng, n, m)
    s, d = rng.randrange(n), rng.randrange(n)
    assert mod.Solution().validPath(n, e, s, d) == brute(n, e, s, d)
    tests.append(case(f"h-rand-{k}", True, n, e, s, d))

# Long shuffled chain: deep recursion breaks naive recursive DFS; path exists end to end.
n = 12000
perm = list(range(n)); rng.shuffle(perm)
chain = [[perm[i], perm[i + 1]] for i in range(n - 1)]; rng.shuffle(chain)
tests.append(case("h-long-chain", True, n, chain, perm[0], perm[-1]))
# Two big halves with no bridge: must explore everything and say false.
n = 12000
left = [[rng.randrange(n // 2), rng.randrange(n // 2)] for _ in range(3000)]
left += [[i, i + 1] for i in range(n // 2 - 1) if i % 3 == 0]
right = [[n // 2 + rng.randrange(n // 2), n // 2 + rng.randrange(n // 2)] for _ in range(3000)]
tests.append(case("h-large-disconnected", True, n, left + right, 0, n - 1))
# Max vertices, few edges.
tests.append(case("h-many-vertices", True, 200000, [[0, 199999], [199999, 5]], 5, 0))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
