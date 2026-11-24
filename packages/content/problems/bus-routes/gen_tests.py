"""Regenerates tests.json deterministically from the Python reference solution.

Brute force (Dijkstra-free BFS over (stop) states where an edge joins every pair of stops on the
same route, counting rides) is checked against the reference on small random instances first.
"""
import json, random, importlib.util, pathlib
from collections import deque

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


def brute(routes, source, target):
    if source == target:
        return 0
    adj = {}
    for r in routes:
        for a in r:
            for b in r:
                if a != b:
                    adj.setdefault(a, set()).add(b)
    dist = {source: 0}; q = deque([source])
    while q:
        u = q.popleft()
        for v in adj.get(u, ()):
            if v not in dist:
                dist[v] = dist[u] + 1; q.append(v)
    return dist.get(target, -1)


def solve(routes, s, t):
    return mod.Solution().numBusesToDestination([list(r) for r in routes], s, t)


def random_routes(rng, n_routes, n_stops, max_len, stop_space=10**6):
    labels = rng.sample(range(stop_space), n_stops)
    return [rng.sample(labels, rng.randint(1, min(max_len, n_stops))) for _ in range(n_routes)], labels


def case(id, hidden, routes, s, t, explanation=None):
    t_ = {"id": id, "hidden": hidden, "ctorArgs": [],
          "calls": [{"method": "numBusesToDestination", "args": [routes, s, t]}], "expected": [solve(routes, s, t)]}
    if explanation: t_["explanation"] = explanation
    return t_


rng = random.Random(815)
for _ in range(500):
    routes, labels = random_routes(rng, rng.randint(1, 6), rng.randint(1, 12), 4, stop_space=30)
    s, t = rng.choice(labels + [99]), rng.choice(labels + [98])
    assert solve(routes, s, t) == brute(routes, s, t)


def chain(rng, k, width, extra_stops):
    """k buses in a chain: bus i shares one stop with bus i+1; each also has random private stops.
    The answer from the first bus's private stop to the last bus's private stop is k."""
    stops = rng.sample(range(10**6), k * (width + 1) + extra_stops)
    links = stops[:k - 1]
    private = stops[k - 1:]
    routes = []
    for i in range(k):
        r = private[i * width:(i + 1) * width]
        if i > 0: r = r + [links[i - 1]]
        if i < k - 1: r = r + [links[i]]
        rng.shuffle(r)
        routes.append(r)
    order = list(range(k)); rng.shuffle(order)
    shuffled = [routes[i] for i in order]
    return shuffled, routes[0][0] if routes[0][0] not in links else routes[0][-1], \
        next(x for x in routes[-1] if x not in links)


tests = [
    case("s1", False, [[1, 4, 7], [3, 6, 7]], 1, 6, "Bus 0 to stop 7, then bus 1 to stop 6: two buses."),
    case("s2", False, [[2, 5], [5, 8, 9], [9, 12], [20, 21]], 2, 21, "Stops 20 and 21 are on an isolated line."),
    case("s3", False, [[10, 11]], 4, 4, "Already there: no bus needed."),
    case("h-same-bus", True, [[1, 2, 3, 4, 5]], 5, 1, "One bus covers both stops (it loops)."),
    case("h-source-unserved", True, [[1, 2], [2, 3]], 0, 3),
    case("h-target-unserved", True, [[1, 2], [2, 3]], 1, 7),
    case("h-transfers-vs-stops", True, [[1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 100], [100, 9]], 1, 9,
         "Many stops but one bus; the short-looking path uses two."),
    case("h-hub", True, [[0, i, i + 1000] for i in range(1, 40)] + [[1039, 777]], 1, 777,
         "Stop 0 is a hub shared by 39 buses."),
]
for k, (nr, ns, ml) in enumerate([(3, 8, 3), (6, 20, 5), (15, 60, 8), (40, 200, 15), (120, 1000, 30), (300, 5000, 40)]):
    routes, labels = random_routes(rng, nr, ns, ml)
    s, t = rng.sample(labels, 2)
    tests.append(case(f"h-rand-{k}", True, routes, s, t))
routes, s, t = chain(rng, 60, 20, 0)
tests.append(case("h-chain-60", True, routes, s, t, "60 buses in a line, each sharing one stop with the next."))
routes, s, t = chain(rng, 500, 15, 0)
tests.append(case("h-chain-500", True, routes, s, t))
# Few very long routes: pairwise stop edges would be ~ 4 * 4000^2.
routes, s, t = chain(rng, 4, 4000, 0)
tests.append(case("h-long-routes", True, routes, s, t, "Four routes of 4000 stops each."))
# Unreachable target with a large reachable component: the island route uses labels >= 10**6 - 2,
# which random_routes never produces below.
routes, labels = random_routes(rng, 200, 3000, 30, stop_space=10**6 - 2)
routes.insert(rng.randrange(len(routes)), [999999, 999998])
tests.append(case("h-large-unreachable", True, routes, labels[0], 999998))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
