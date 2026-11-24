"""Regenerates tests.json deterministically from the Python reference solution.

A full sort by (-count, word) is checked against the reference on small random inputs first.
"""
import json, random, string, importlib.util, pathlib
from collections import Counter

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


def brute(words, k):
    c = Counter(words)
    return sorted(c, key=lambda w: (-c[w], w))[:k]


def solve(words, k):
    return mod.Solution().topKFrequent(list(words), k)


def case(id, hidden, words, k, explanation=None):
    got = solve(words, k)
    assert got == brute(words, k), id
    t = {"id": id, "hidden": hidden, "ctorArgs": [],
         "calls": [{"method": "topKFrequent", "args": [words, k]}], "expected": [got]}
    if explanation: t["explanation"] = explanation
    return t


def vocab(rng, m, max_len=10, alphabet=string.ascii_lowercase):
    s = set()
    while len(s) < m:
        s.add("".join(rng.choice(alphabet) for _ in range(rng.randint(1, max_len))))
    return sorted(s)


def zipf_words(rng, m, n, max_len=10, alphabet=string.ascii_lowercase):
    v = vocab(rng, m, max_len, alphabet)
    weights = [1 / (i + 1) for i in range(m)]
    rng.shuffle(weights)
    return rng.choices(v, weights=weights, k=n)


rng = random.Random(692)
for _ in range(500):
    w = zipf_words(rng, rng.randint(1, 8), rng.randint(1, 20), 3, "abc")
    k = rng.randint(1, len(set(w)))
    assert solve(w, k) == brute(w, k)

tests = [
    case("s1", False, ["go", "run", "go", "jump", "run", "go", "fly"], 2),
    case("s2", False, ["b", "a", "c", "b", "a", "c", "d"], 2,
         "a, b and c tie with 2; alphabetical order keeps a and b."),
    case("h-single", True, ["solo"], 1),
    case("h-prefix-order", True, ["apple", "app", "apple", "app", "ap", "ap", "a"], 3,
         "'ap' < 'app' < 'apple' lexicographically."),
    case("h-all-distinct", True, ["delta", "alpha", "echo", "charlie", "bravo"], 3,
         "Every word appears once, so this is purely alphabetical."),
    case("h-k-all", True, ["x", "y", "x", "z", "y", "x"], 3),
    case("h-boundary-tie", True, ["m", "m", "m", "z", "z", "y", "y", "a", "q", "q"], 3,
         "Three words tie at count 2 for the last two slots: q and y win over z."),
    case("h-heap-tiebreak-trap", True, ["e", "d", "c", "b", "a", "e", "d", "c", "b", "a", "f"], 4,
         "A size-k min-heap must evict the alphabetically larger word on ties."),
]
for k_, (m, n, k) in enumerate([(5, 20, 2), (20, 100, 5), (100, 500, 10), (500, 3000, 40), (50, 2000, 50)]):
    tests.append(case(f"h-rand-{k_}", True, zipf_words(rng, m, n), k))
# Many ties: small alphabet, short words, nearly uniform counts.
small = vocab(rng, 60, 2, "abcdefgh")
w = [rng.choice(small) for _ in range(4000)]
tests.append(case("h-many-ties", True, w, 25))
tests.append(case("h-large", True, zipf_words(rng, 4000, 20000, 6), 100))
unique = vocab(rng, 8000, 7); rng.shuffle(unique)
tests.append(case("h-large-all-unique", True, unique, 10))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
