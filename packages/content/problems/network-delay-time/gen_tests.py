"""Regenerates tests.json deterministically from the Python reference solution.

Cross-checked against Bellman-Ford on small random graphs.
"""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


def brute(times, n, k):
    INF = float("inf")
    dist = [INF] * (n + 1); dist[k] = 0
    for _ in range(n):
        for u, v, w in times:
            if dist[u] + w < dist[v]:
                dist[v] = dist[u] + w
    m = max(dist[1:])
    return -1 if m == INF else m


def case(id, hidden, times, n, k, explanation=None):
    got = mod.Solution().networkDelayTime([list(t) for t in times], n, k)
    if n * len(times) <= 200000:
        assert got == brute(times, n, k), id
    t = {"id": id, "hidden": hidden, "ctorArgs": [],
         "calls": [{"method": "networkDelayTime", "args": [times, n, k]}], "expected": [got]}
    if explanation: t["explanation"] = explanation
    return t


def rand_graph(rng, n, m, wmax, connected_from=None):
    times = []
    if connected_from is not None:  # random spanning arborescence so everything is reachable
        order = [connected_from] + rng.sample([i for i in range(1, n + 1) if i != connected_from], n - 1)
        for i in range(1, n):
            times.append([order[rng.randrange(i)], order[i], rng.randint(0, wmax)])
    while len(times) < m:
        times.append([rng.randint(1, n), rng.randint(1, n), rng.randint(0, wmax)])
    rng.shuffle(times)
    return times


rng = random.Random(743)
for _ in range(400):
    n = rng.randint(1, 8)
    times = rand_graph(rng, n, rng.randint(0, 15), rng.choice([0, 3, 20]))
    k = rng.randint(1, n)
    assert mod.Solution().networkDelayTime(times, n, k) == brute(times, n, k)

tests = [
    case("s1", False, [[1, 2, 4], [1, 3, 1], [3, 2, 2], [2, 4, 1]], 4, 1,
         "Node 2 is reached at time 3 via node 3, so node 4 is reached at 4."),
    case("s2", False, [[1, 2, 5]], 2, 2, "Links are one-way: node 1 never hears the message."),
    case("s3", False, [], 1, 1, "The only node is the source."),
    case("h-zero-weights", True, [[1, 2, 0], [2, 3, 0], [3, 1, 0]], 3, 2),
    case("h-parallel-and-self", True, [[1, 2, 9], [1, 2, 3], [2, 2, 1], [2, 3, 4], [1, 3, 8]], 3, 1),
    case("h-visit-on-push-trap", True, [[1, 4, 10], [1, 2, 1], [2, 3, 1], [3, 4, 1], [4, 5, 1]], 5, 1,
         "Marking node 4 settled when first pushed (cost 10) gives 11 instead of 4."),
    case("h-unreachable-isolated", True, [[1, 2, 1], [2, 3, 1]], 4, 1),
    case("h-source-in-middle", True, [[3, 1, 7], [3, 2, 2], [2, 4, 2], [4, 1, 2]], 4, 3),
]
for k in range(8):
    n = rng.randint(5, 80)
    src = rng.randint(1, n)
    times = rand_graph(rng, n, rng.randint(n, 4 * n), rng.choice([10, 100, 1000]),
                       connected_from=src if k % 4 != 3 else None)
    tests.append(case(f"h-rand-{k}", True, times, n, src))

# Large: chain whose edges are listed backwards (Bellman-Ford needs ~n passes) plus heavy shortcuts.
n = 5000
chain = [[i, i + 1, 1] for i in range(1, n)]
chain.reverse()
shortcuts = []
for _ in range(4500):
    a = rng.randint(1, n - 1); b = rng.randint(a + 1, n)
    shortcuts.append([a, b, (b - a) + rng.randint(1, 50)])  # never better than the chain
tests.append(case("h-large-chain", True, chain + shortcuts, n, 1))
# Large random reachable graph.
n = 4000
tests.append(case("h-large-random", True, rand_graph(rng, n, 7000, 1000, connected_from=17), n, 17))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
