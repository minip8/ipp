"""Regenerates tests.json deterministically from the Python reference solution.

Cross-checked against BFS over an explicitly built pairwise-comparison graph on small inputs.
"""
import json, random, importlib.util, pathlib
from collections import deque

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


def brute(begin, end, words):
    if end not in words:
        return 0
    nodes = [begin] + [w for w in words if w != begin]
    adj = lambda a, b: sum(x != y for x, y in zip(a, b)) == 1
    dist = {begin: 1}; q = deque([begin])
    while q:
        u = q.popleft()
        if u == end:
            return dist[u]
        for v in nodes:
            if v not in dist and adj(u, v):
                dist[v] = dist[u] + 1; q.append(v)
    return 0


def case(id, hidden, begin, end, words, explanation=None):
    got = mod.Solution().ladderLength(begin, end, list(words))
    if len(words) <= 400:
        assert got == brute(begin, end, words), id
    t = {"id": id, "hidden": hidden, "ctorArgs": [],
         "calls": [{"method": "ladderLength", "args": [begin, end, words]}], "expected": [got]}
    if explanation: t["explanation"] = explanation
    return t


def rand_word(rng, L, alpha):
    return "".join(rng.choice(alpha) for _ in range(L))


def rand_instance(rng, n, L, alpha, end_in=True):
    words = set()
    while len(words) < n:
        words.add(rand_word(rng, L, alpha))
    words = sorted(words); rng.shuffle(words)
    begin = rand_word(rng, L, alpha)
    end = rng.choice(words) if end_in else rand_word(rng, L, alpha)
    while end == begin:
        begin = rand_word(rng, L, alpha)
    if not end_in and end in words:
        words.remove(end)
    return begin, end, words


rng = random.Random(127)
for _ in range(400):
    L = rng.randint(1, 4)
    alpha = "abcdefghijklmnopqrstuvwxyz"[:rng.randint(2, 5)]
    n = rng.randint(1, min(30, len(alpha) ** L))
    b, e, w = rand_instance(rng, n, L, alpha, end_in=rng.random() < 0.85)
    assert mod.Solution().ladderLength(b, e, w) == brute(b, e, w)

ex = ["cord", "card", "ward", "warm", "word", "worm", "wore"]
tests = [
    case("s1", False, "cold", "warm", ex, "cold -> cord -> card -> ward -> warm: 5 words."),
    case("s2", False, "cold", "warm", ["cord", "card", "ward", "word", "worm"], "warm is not in the list."),
    case("s3", False, "hit", "hot", ["hot"], "One change, two words."),
    case("h-one-letter", True, "a", "c", ["a", "b", "c"]),
    case("h-begin-in-list", True, "dog", "cat", ["dog", "dot", "cot", "cat"]),
    case("h-disconnected", True, "aaa", "zzz", ["aab", "abb", "zzz", "zzy"]),
    case("h-no-shortcut-via-begin", True, "abc", "xyz", ["xbc", "xyc", "xyz", "abz"]),
]
configs = [(20, 3, "abcd"), (60, 4, "abcd"), (150, 4, "abcdef"), (300, 5, "abcd"), (300, 3, "abcdefghij"), (200, 6, "abc")]
for k, (n, L, alpha) in enumerate(configs):
    tests.append(case(f"h-rand-{k}", True, *rand_instance(rng, n, L, alpha)))
tests.append(case("h-rand-noend", True, *rand_instance(rng, 200, 4, "abcde", end_in=False)))

# Large dense: 5000 words of length 6 over 5 letters (pairwise comparison is ~2.5e7 pairs).
b, e, w = rand_instance(rng, 5000, 6, "abcde")
tests.append(case("h-large-dense", True, b, e, w))
# Large, long ladder: a path that walks letters forward one position at a time, with decoys.
L = 10
path = []
cur = list("a" * L)
path.append("".join(cur))
for step in range(L * 12):
    i = step % L
    cur[i] = chr(ord(cur[i]) + 1)
    path.append("".join(cur))
decoys = set()
while len(decoys) < 3500:
    decoys.add(rand_word(rng, L, "nopqrstuvwxyz"))
words = path[1:] + sorted(decoys); rng.shuffle(words)
tests.append(case("h-large-long", True, path[0], path[-1], words))
# Large, unreachable end: whole dense component explored before answering 0.
b, e, w = rand_instance(rng, 4000, 5, "abcdef")
e = "zzzzz"; w.append(e)
tests.append(case("h-large-unreachable", True, b, e, w))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
