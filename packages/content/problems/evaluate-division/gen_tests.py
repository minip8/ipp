"""Regenerates tests.json deterministically from the Python reference solution.

Instances are built from hidden true values for every name, so they are consistent by
construction; a BFS brute force and the true values themselves are checked against the
reference before writing.
"""
import json, math, random, string, importlib.util, pathlib
from collections import deque

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


def brute(equations, values, queries):
    adj = {}
    for (a, b), k in zip(equations, values):
        adj.setdefault(a, []).append((b, k)); adj.setdefault(b, []).append((a, 1 / k))
    out = []
    for c, d in queries:
        if c not in adj or d not in adj:
            out.append(-1.0); continue
        val = {c: 1.0}; q = deque([c])
        while q:
            u = q.popleft()
            for v, w in adj[u]:
                if v not in val:
                    val[v] = val[u] * w; q.append(v)
        out.append(val.get(d, -1.0))
    return out


def close(a, b):
    return abs(a - b) <= 1e-6 or abs(a - b) <= 1e-6 * max(abs(a), abs(b))


def solve(e, v, q):
    return mod.Solution().calcEquation([list(x) for x in e], list(v), [list(x) for x in q])


def names(rng, n):
    s = set()
    while len(s) < n:
        s.add("".join(rng.choice(string.ascii_lowercase + string.digits) for _ in range(rng.randint(1, 4))))
    return sorted(s)


def gen(rng, n_names, n_groups, n_eq, n_q, unknown=3, tree_like=False):
    """Each name gets a true value; names are split into groups; equations only within a group.
    Values are chosen so every ratio along an equation is in [0.01, 100] and every derivable ratio
    stays well inside [1e-9, 1e9]."""
    ns = names(rng, n_names + unknown)
    unknown_names, ns = ns[:unknown], ns[unknown:]
    rng.shuffle(ns)
    group = {x: rng.randrange(n_groups) for x in ns}
    true = {x: math.exp(rng.uniform(-2.2, 2.2)) for x in ns}  # every ratio within e^4.4 ~ 81
    members = {}
    for x in ns:
        members.setdefault(group[x], []).append(x)
    eqs, vals = [], []
    seen = set()
    for g, mem in members.items():  # spanning chain/tree so groups are connected
        for i in range(1, len(mem)):
            a = mem[i]; b = mem[i - 1] if not tree_like else mem[rng.randrange(i)]
            seen.add((a, b))
            eqs.append([a, b] if rng.random() < 0.5 else [b, a])
    attempts = 0
    while len(eqs) < n_eq and attempts < 10 * n_eq:
        attempts += 1
        g = rng.choice(list(members))
        if len(members[g]) < 2:
            continue
        a, b = rng.sample(members[g], 2)
        if (a, b) in seen or (b, a) in seen:
            continue
        seen.add((a, b)); eqs.append([a, b])
    rng.shuffle(eqs)
    for a, b in eqs:
        r = true[a] / true[b]
        vals.append(r)
    queries = []
    for _ in range(n_q):
        t = rng.random()
        if t < 0.1:
            queries.append([rng.choice(unknown_names), rng.choice(ns + unknown_names)])
        elif t < 0.15:
            x = rng.choice(ns + unknown_names); queries.append([x, x])
        else:
            queries.append(rng.sample(ns, 2) if len(ns) > 1 else [ns[0], ns[0]])
    return eqs, vals, queries, true


def case(id, hidden, e, v, q, explanation=None, true=None):
    got = solve(e, v, q)
    want = brute(e, v, q)
    assert all(close(a, b) for a, b in zip(got, want)), id
    if true:
        for (c, d), r in zip(q, got):
            if r != -1.0:
                assert close(r, true[c] / true[d]), id
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "calcEquation", "args": [e, v, q]}],
         "expected": [got]}
    if explanation: t["explanation"] = explanation
    return t


rng = random.Random(399)
for _ in range(300):
    e, v, q, true = gen(rng, rng.randint(2, 8), rng.randint(1, 3), rng.randint(1, 10), 10, unknown=2)
    assert all(close(a, b) for a, b in zip(solve(e, v, q), brute(e, v, q)))

tests = [
    case("s1", False, [["usd", "eur"], ["eur", "gbp"], ["yen", "cny"]], [1.25, 1.2, 0.05],
         [["usd", "gbp"], ["gbp", "usd"], ["usd", "yen"], ["eur", "eur"], ["btc", "btc"], ["cny", "yen"]],
         "usd/gbp = 1.25 * 1.2; usd and yen are not linked; btc is unknown so btc/btc is -1."),
    case("s2", False, [["a", "b"], ["c", "b"]], [4.0, 2.0], [["a", "c"], ["c", "a"], ["b", "b"]],
         "a/c = (a/b) / (c/b) = 4 / 2."),
    case("h-reverse-only", True, [["x", "y"]], [0.5], [["y", "x"], ["x", "y"], ["y", "y"], ["z", "x"]]),
    case("h-long-chain-direction", True, [["n%d" % (i + 1), "n%d" % i] for i in range(30)], [1.5] * 30,
         [["n30", "n0"], ["n0", "n30"], ["n15", "n10"], ["n0", "n0"]],
         "Each step multiplies by 1.5, so n30/n0 = 1.5^30."),
    case("h-cycle-consistent", True, [["p", "q"], ["q", "r"], ["r", "p"]], [2.0, 3.0, 1 / 6],
         [["p", "r"], ["r", "q"], ["q", "p"], ["p", "p"]], "A consistent cycle must not loop forever."),
    case("h-merge-two-groups-late", True, [["a", "b"], ["c", "d"], ["e", "f"], ["b", "c"], ["d", "e"]],
         [2.0, 3.0, 5.0, 7.0, 11.0], [["a", "f"], ["f", "a"], ["b", "e"], ["c", "a"]]),
]
for k, (n, g, m, qn) in enumerate([(6, 2, 6, 10), (15, 3, 20, 30), (40, 4, 60, 80), (120, 6, 200, 200)]):
    e, v, q, true = gen(rng, n, g, m, qn)
    tests.append(case(f"h-rand-{k}", True, e, v, q, true=true))
e, v, q, true = gen(rng, 1500, 3, 1800, 1500, tree_like=False)
tests.append(case("h-large-chains", True, e, v, q, true=true))
e, v, q, true = gen(rng, 1800, 1, 1900, 1500, tree_like=True)
tests.append(case("h-large-one-group", True, e, v, q, true=true))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
