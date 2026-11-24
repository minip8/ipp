"""Regenerates tests.json deterministically from the Python reference solution.

Cross-checked against exhaustive path enumeration on small graphs; some hidden tests are
asserted to defeat plain (city-only) Dijkstra and in-place relaxation.
"""
import json, random, importlib.util, pathlib, heapq

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


def brute(n, flights, src, dst, k):
    adj = [[] for _ in range(n)]
    for u, v, p in flights:
        adj[u].append((v, p))
    best = float("inf")

    def go(u, cost, used):
        nonlocal best
        if u == dst:
            best = min(best, cost)
            return
        if used == k + 1:
            return
        for v, p in adj[u]:
            go(v, cost + p, used + 1)

    go(src, 0, 0)
    return -1 if best == float("inf") else best


def wrong_dijkstra(n, flights, src, dst, k):
    """City-only Dijkstra that tracks stops but settles each city once."""
    adj = [[] for _ in range(n)]
    for u, v, p in flights:
        adj[u].append((v, p))
    seen = set()
    pq = [(0, src, 0)]
    while pq:
        c, u, used = heapq.heappop(pq)
        if u == dst:
            return c
        if u in seen or used == k + 1:
            continue
        seen.add(u)
        for v, p in adj[u]:
            heapq.heappush(pq, (c + p, v, used + 1))
    return -1


def in_place(n, flights, src, dst, k):
    cost = [float("inf")] * n; cost[src] = 0
    for _ in range(k + 1):
        for u, v, p in flights:
            cost[v] = min(cost[v], cost[u] + p)
    return -1 if cost[dst] == float("inf") else cost[dst]


def case(id, hidden, n, flights, src, dst, k, explanation=None, traps=()):
    got = mod.Solution().findCheapestPrice(n, [list(f) for f in flights], src, dst, k)
    if n <= 8 and len(flights) <= 25:
        assert got == brute(n, flights, src, dst, k), id
    for trap in traps:
        assert trap(n, flights, src, dst, k) != got, (id, trap.__name__)
    t = {"id": id, "hidden": hidden, "ctorArgs": [],
         "calls": [{"method": "findCheapestPrice", "args": [n, flights, src, dst, k]}], "expected": [got]}
    if explanation: t["explanation"] = explanation
    return t


def rand_flights(rng, n, m, pmax):
    pairs = set()
    while len(pairs) < m:
        u, v = rng.randrange(n), rng.randrange(n)
        if u != v:
            pairs.add((u, v))
    out = [[u, v, rng.randint(1, pmax)] for u, v in sorted(pairs)]
    rng.shuffle(out)
    return out


rng = random.Random(787)
for _ in range(500):
    n = rng.randint(2, 7)
    fl = rand_flights(rng, n, rng.randint(0, min(14, n * (n - 1))), rng.choice([5, 100]))
    src, dst = rng.sample(range(n), 2)
    k = rng.randint(0, n - 1)
    assert mod.Solution().findCheapestPrice(n, fl, src, dst, k) == brute(n, fl, src, dst, k)

ex = [[0, 1, 100], [1, 2, 100], [2, 0, 100], [1, 3, 600], [2, 3, 200]]
tests = [
    case("s1", False, 4, ex, 0, 3, 1, "0 -> 1 -> 3 costs 700; the 400 route needs two stops."),
    case("s2", False, 3, [[0, 1, 100], [1, 2, 100], [0, 2, 500]], 0, 2, 1, "One stop allowed: go via city 1."),
    case("s3", False, 3, [[0, 1, 100], [1, 2, 100], [0, 2, 500]], 0, 2, 0, "No stops allowed: only the direct flight."),
    case("h-in-place-trap", True, 3, [[0, 1, 1], [1, 2, 1], [0, 2, 10]], 0, 2, 0,
         "Relaxing in place in one round would chain 0->1->2 with zero stops.", traps=(in_place,)),
    case("h-dijkstra-trap", True, 5, [[0, 1, 1], [1, 2, 1], [0, 2, 5], [2, 3, 1], [3, 4, 1]], 0, 4, 2,
         "Cheapest way to city 2 uses a stop; with k = 2 we must reach 2 directly.", traps=(wrong_dijkstra,)),
    case("h-unreachable", True, 4, [[0, 1, 5], [1, 0, 5], [2, 3, 5]], 0, 3, 3),
    case("h-too-few-stops", True, 4, [[0, 1, 1], [1, 2, 1], [2, 3, 1]], 0, 3, 1),
    case("h-no-flights", True, 2, [], 0, 1, 1),
    case("h-dst-revisit", True, 4, [[0, 3, 50], [3, 1, 1], [1, 2, 1], [2, 3, 1], [0, 1, 1]], 0, 3, 2),
]
k_found = 0
attempts = 0
while k_found < 6:
    attempts += 1
    n = rng.randint(5, 8)
    fl = rand_flights(rng, n, rng.randint(n, 20), 50)
    src, dst = rng.sample(range(n), 2)
    k = rng.randint(0, 3)
    got = mod.Solution().findCheapestPrice(n, fl, src, dst, k)
    if got != -1 and wrong_dijkstra(n, fl, src, dst, k) != got:
        tests.append(case(f"h-rand-trap-{k_found}", True, n, fl, src, dst, k, traps=(wrong_dijkstra,)))
        k_found += 1
for i in range(6):
    n = rng.randint(8, 60)
    fl = rand_flights(rng, n, rng.randint(n, min(4 * n, n * (n - 1))), rng.choice([20, 10000]))
    src, dst = rng.sample(range(n), 2)
    tests.append(case(f"h-rand-{i}", True, n, fl, src, dst, rng.randint(0, n - 1)))

# Dense graph with moderate k: exhaustive DFS explodes.
n = 60
fl = rand_flights(rng, n, 2500, 10000)
tests.append(case("h-dense", True, n, fl, 0, 59, 10))
# Long cheap chain needing many stops plus expensive shortcuts; k = n - 1.
n = 600
chain = [[i, i + 1, 1] for i in range(n - 1)]
extra = []
pairs = {(i, i + 1) for i in range(n - 1)}
while len(extra) < 4000:
    a, b = rng.randrange(n), rng.randrange(n)
    if a != b and (a, b) not in pairs:
        pairs.add((a, b)); extra.append([a, b, rng.randint(2 * abs(b - a) + 5, 10000)])
allf = chain[::-1] + extra; rng.shuffle(allf)
tests.append(case("h-large-chain", True, n, allf, 0, n - 1, n - 1))
tests.append(case("h-large-chain-limited", True, n, allf, 0, n - 1, 40))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
