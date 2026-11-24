"""Regenerates tests.json deterministically from the Python reference solution.

Brute force (BFS connectivity + explicit DFS cycle check, no edge-count shortcut) is checked
against the reference on small random graphs first.
"""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


def brute(n, edges):
    adj = [[] for _ in range(n)]
    for i, (a, b) in enumerate(edges):
        adj[a].append((b, i)); adj[b].append((a, i))
    seen = [False] * n
    seen[0] = True
    stack = [(0, -1)]
    while stack:
        u, via = stack.pop()
        for v, i in adj[u]:
            if i == via:
                continue
            if seen[v]:
                return False  # reached a visited node through a new edge: cycle
            seen[v] = True
            stack.append((v, i))
    return all(seen)


def solve(n, edges):
    return mod.Solution().validTree(n, [list(e) for e in edges])


def random_tree(rng, n):
    labels = list(range(n)); rng.shuffle(labels)
    edges = [[labels[rng.randrange(i)], labels[i]] for i in range(1, n)]
    rng.shuffle(edges)
    return [e if rng.random() < 0.5 else e[::-1] for e in edges]


def add_edge(rng, n, edges):
    have = {tuple(sorted(e)) for e in edges}
    while True:
        a, b = rng.sample(range(n), 2)
        if (min(a, b), max(a, b)) not in have:
            edges = edges + [[a, b]]
            rng.shuffle(edges)
            return edges


def tree_with_cycle_and_split(rng, n):
    """n - 1 edges but one cycle and therefore two components: the edge-count check alone passes."""
    e = random_tree(rng, n)
    e.pop(rng.randrange(len(e)))
    return add_edge(rng, n, e)


def case(id, hidden, n, edges, explanation=None):
    t = {"id": id, "hidden": hidden, "ctorArgs": [],
         "calls": [{"method": "validTree", "args": [n, edges]}], "expected": [solve(n, edges)]}
    if explanation: t["explanation"] = explanation
    return t


rng = random.Random(261)
for _ in range(500):
    n = rng.randint(1, 9)
    choice = rng.random()
    if n == 1:
        e = []
    elif choice < 0.3:
        e = random_tree(rng, n)
    elif choice < 0.6:
        e = tree_with_cycle_and_split(rng, n) if n >= 3 else random_tree(rng, n)
    else:
        e = random_tree(rng, n)
        e = e[:rng.randint(0, len(e))]
        for _ in range(rng.randint(0, 2)):
            if len(e) < n * (n - 1) // 2:
                e = add_edge(rng, n, e)
    assert solve(n, e) == brute(n, e), (n, e)

tests = [
    case("s1", False, 5, [[0, 1], [0, 2], [0, 3], [1, 4]]),
    case("s2", False, 5, [[0, 1], [1, 2], [2, 3], [1, 3], [1, 4]], "Edges 1-2, 2-3, 3-1 form a cycle."),
    case("s3", False, 4, [[0, 1], [2, 3]], "Two separate pieces: not connected."),
    case("h-single-node", True, 1, []),
    case("h-two-no-edge", True, 2, []),
    case("h-two-one-edge", True, 2, [[1, 0]]),
    case("h-right-count-but-cycle", True, 6, [[0, 1], [1, 2], [2, 0], [3, 4], [4, 5]], "Correct edge count, still a cycle and two components."),
    case("h-too-many", True, 4, [[0, 1], [1, 2], [2, 3], [3, 0]]),
    case("h-forest", True, 7, [[0, 1], [1, 2], [3, 4], [5, 6]]),
]
for k, n in enumerate([10, 50, 300, 2000]):
    tests.append(case(f"h-tree-{k}", True, n, random_tree(rng, n)))
    tests.append(case(f"h-split-cycle-{k}", True, n, tree_with_cycle_and_split(rng, n)))
for k, n in enumerate([20, 400]):
    tests.append(case(f"h-tree-plus-{k}", True, n, add_edge(rng, n, random_tree(rng, n))))
    tests.append(case(f"h-tree-minus-{k}", True, n, random_tree(rng, n)[:-1]))
n = 7000
perm = list(range(n)); rng.shuffle(perm)
path = [[perm[i], perm[i + 1]] for i in range(n - 1)]; rng.shuffle(path)
tests.append(case("h-long-path", True, n, path, "A path of 7000 nodes (deep recursion)."))
tests.append(case("h-large-tree", True, 7000, random_tree(rng, 5000)))
tests.append(case("h-large-split", True, 7000, tree_with_cycle_and_split(rng, 5000)))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
