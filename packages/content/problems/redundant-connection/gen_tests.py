"""Regenerates tests.json deterministically from the Python reference solution.

Brute force (remove each edge from last to first, test for a spanning tree) is checked against the
reference on small random instances first.
"""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


def is_tree(n, edges):
    adj = {i: [] for i in range(1, n + 1)}
    for a, b in edges:
        adj[a].append(b); adj[b].append(a)
    seen, stack = {1}, [1]
    while stack:
        u = stack.pop()
        for v in adj[u]:
            if v not in seen:
                seen.add(v); stack.append(v)
    return len(seen) == n and len(edges) == n - 1


def brute(edges):
    n = len(edges)
    for i in range(n - 1, -1, -1):
        if is_tree(n, edges[:i] + edges[i + 1:]):
            return edges[i]


def solve(edges):
    return mod.Solution().findRedundantConnection([list(e) for e in edges])


def make(rng, n, cycle_len=None):
    """Random tree on 1..n plus one extra edge, shuffled, endpoints randomly ordered."""
    labels = list(range(1, n + 1)); rng.shuffle(labels)
    edges = set()
    if cycle_len:  # force a cycle of a given length using a path inside the tree
        for i in range(cycle_len - 1):
            edges.add((labels[i], labels[i + 1]))
        start = cycle_len
    else:
        start = 1
    for i in range(start, n):
        edges.add((labels[rng.randrange(i)], labels[i]))
    while True:
        if cycle_len:
            extra = (labels[0], labels[cycle_len - 1])
        else:
            extra = tuple(rng.sample(labels, 2))
        if extra not in edges and extra[::-1] not in edges:
            break
    edges = list(edges) + [extra]
    rng.shuffle(edges)
    return [[a, b] if rng.random() < 0.5 else [b, a] for a, b in edges]


def case(id, hidden, edges, explanation=None):
    t = {"id": id, "hidden": hidden, "ctorArgs": [],
         "calls": [{"method": "findRedundantConnection", "args": [edges]}], "expected": [solve(edges)]}
    if explanation: t["explanation"] = explanation
    return t


rng = random.Random(684)
for _ in range(500):
    e = make(rng, rng.randint(3, 10))
    assert solve(e) == brute(e), e

tests = [
    case("s1", False, [[1, 2], [1, 3], [2, 3]], "Any of the three works; [2, 3] is listed last."),
    case("s2", False, [[1, 2], [2, 3], [3, 4], [1, 4], [1, 5]],
         "The cycle is 1-2-3-4. [1, 5] is not on it, so the answer is [1, 4]."),
    case("h-extra-first", True, [[4, 1], [1, 2], [2, 3], [3, 4], [5, 2]],
         "The cycle closes at [3, 4], even though [4, 1] could be considered the 'extra' one."),
    case("h-reversed-endpoints", True, [[3, 1], [2, 1], [3, 2], [4, 3]], "Return [3, 2] exactly as written."),
    case("h-cycle-at-end-of-list-not-last", True, [[2, 5], [1, 2], [5, 1], [3, 4], [4, 1]]),
    case("h-whole-graph-cycle", True, [[i, i + 1] for i in range(1, 8)] + [[8, 1]]),
]
for k, n in enumerate([5, 8, 12, 30, 100, 500, 2000]):
    tests.append(case(f"h-rand-{k}", True, make(rng, n)))
tests.append(case("h-long-cycle", True, make(rng, 2000, cycle_len=1800)))
tests.append(case("h-large", True, make(rng, 7000)))
tests.append(case("h-large-long-cycle", True, make(rng, 7000, cycle_len=6500)))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
