"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib
from collections import deque

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


def bfs(a, b, alpha):
    """Independent check: shortest path over strings, one edit per edge (tiny inputs only)."""
    limit = max(len(a), len(b)) + 1
    dist, q = {a: 0}, deque([a])
    while q:
        s = q.popleft()
        if s == b:
            return dist[s]
        nxt = set()
        for i in range(len(s) + 1):
            if len(s) < limit:
                nxt.update(s[:i] + c + s[i:] for c in alpha)
            if i < len(s):
                nxt.add(s[:i] + s[i + 1:])
                nxt.update(s[:i] + c + s[i + 1:] for c in alpha)
        for t in nxt:
            if t not in dist:
                dist[t] = dist[s] + 1
                q.append(t)


def case(id, hidden, a, b, explanation=None):
    got = mod.Solution().minDistance(a, b)
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "minDistance", "args": [a, b]}],
         "expected": [got]}
    if explanation: t["explanation"] = explanation
    return t


def rs(rng, alpha, n):
    return "".join(rng.choice(alpha) for _ in range(n))


rng = random.Random(72)
for _ in range(150):
    a, b = rs(rng, "ab", rng.randint(0, 5)), rs(rng, "ab", rng.randint(0, 5))
    assert mod.Solution().minDistance(a, b) == bfs(a, b, "ab"), (a, b)


def mutate(rng, s, edits, alpha):
    s = list(s)
    for _ in range(edits):
        op = rng.randrange(3)
        i = rng.randrange(len(s) + 1)
        if op == 0 or not s:
            s.insert(i, rng.choice(alpha))
        elif op == 1:
            s.pop(min(i, len(s) - 1))
        else:
            s[min(i, len(s) - 1)] = rng.choice(alpha)
    return "".join(s)


tests = [
    case("s1", False, "sunday", "saturday", "Insert 'a' and 't', replace 'n' with 'r'."),
    case("s2", False, "flaw", "lawn", "Delete 'f', append 'n'."),
    case("s3", False, "", "abc", "Three insertions."),
    case("h-both-empty", True, "", ""),
    case("h-to-empty", True, "abcde", ""),
    case("h-equal", True, "interview", "interview"),
    case("h-swap", True, "ab", "ba", "Two edits; max(len) - LCS would wrongly give 1."),
    case("h-all-replace", True, "aaaa", "bbbb"),
    case("h-prefix", True, "abc", "abcxyz"),
    case("h-classic", True, "intention", "execution"),
    case("h-one-char", True, "a", "b"),
]
alpha = "abcdefghijklmnopqrstuvwxyz"
for k, (n, edits) in enumerate([(10, 3), (30, 10), (80, 40), (150, 20)]):
    s = rs(rng, alpha[:6], n)
    tests.append(case(f"h-rand-mut-{k}", True, s, mutate(rng, s, edits, alpha[:6])))
for k, (n, m) in enumerate([(7, 12), (40, 25), (200, 180)]):
    tests.append(case(f"h-rand-{k}", True, rs(rng, alpha[:4], n), rs(rng, alpha[:4], m)))
big = rs(rng, alpha, 500)
tests.append(case("h-large-similar", True, big, mutate(rng, big, 60, alpha)[:500]))
tests.append(case("h-large-random", True, rs(rng, "abc", 500), rs(rng, "abc", 500)))
tests.append(case("h-large-vs-empty", True, rs(rng, alpha, 500), ""))
tests.append(case("h-large-shifted", True, "ab" * 250, "ba" * 250))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
