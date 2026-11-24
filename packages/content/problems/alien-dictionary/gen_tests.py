"""Regenerates tests.json deterministically from the Python reference solution.

Cross-checked against brute force: try every permutation of the present letters in lexicographic
order and return the first one under which the word list is sorted.
"""
import json, random, importlib.util, pathlib, itertools

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


def sorted_under(words, alphabet):
    rank = {c: i for i, c in enumerate(alphabet)}
    keys = [[rank[c] for c in w] for w in words]
    return all(a <= b for a, b in zip(keys, keys[1:]))


def brute(words):
    letters = sorted({c for w in words for c in w})
    for perm in itertools.permutations(letters):
        if sorted_under(words, perm):
            return "".join(perm)
    return ""


def case(id, hidden, words, explanation=None):
    got = mod.Solution().alienOrder(list(words))
    if len({c for w in words for c in w}) <= 7:
        assert got == brute(words), id
    elif got:
        assert sorted_under(words, got), id
    t = {"id": id, "hidden": hidden, "ctorArgs": [],
         "calls": [{"method": "alienOrder", "args": [words]}], "expected": [got]}
    if explanation: t["explanation"] = explanation
    return t


def alien_sorted(rng, n, maxlen, letters):
    alphabet = list(letters); rng.shuffle(alphabet)
    rank = {c: i for i, c in enumerate(alphabet)}
    words = ["".join(rng.choice(letters) for _ in range(rng.randint(1, maxlen))) for _ in range(n)]
    words.sort(key=lambda w: [rank[c] for c in w])
    return words


rng = random.Random(269)
for _ in range(600):
    letters = "abcdefg"[:rng.randint(1, 6)]
    words = alien_sorted(rng, rng.randint(1, 8), 4, letters)
    if rng.random() < 0.4 and len(words) > 1:  # perturb: maybe invalid
        i, j = rng.sample(range(len(words)), 2)
        words[i], words[j] = words[j], words[i]
    assert mod.Solution().alienOrder(words) == brute(words), words

tests = [
    case("s1", False, ["wrt", "wrf", "er", "ett", "rftt"], "t<f, w<e, r<t, e<r force w, e, r, t, f."),
    case("s2", False, ["ba", "bc", "ac", "cab"], "b<a and a<c."),
    case("s3", False, ["zx", "zy", "q"], "x<y and z<q; take the smallest free letter each time."),
    case("s4", False, ["abc", "ab"], "A word cannot precede its own proper prefix."),
    case("h-single-word", True, ["hello"], "No constraints: letters in normal order, each once."),
    case("h-prefix-ok", True, ["ab", "abc", "abcd"], "A prefix before the longer word is fine."),
    case("h-two-cycle", True, ["a", "b", "a"]),
    case("h-cycle-3", True, ["ab", "bc", "ca", "ab"][:3] + ["ac"]),
    case("h-duplicates", True, ["x", "x", "y", "y"]),
    case("h-only-first-diff", True, ["ca", "cb", "da"], "Only the first difference counts: a<b, c<d; nothing about a vs d."),
    case("h-unconstrained-letters", True, ["zq", "zr", "mk"]),
    case("h-prefix-later", True, ["b", "abc", "ab"], "b<a holds, but abc before ab is still invalid."),
]
for k in range(6):
    letters = "abcdefghijklmnopqrstuvwxyz"[:rng.randint(4, 7)]
    tests.append(case(f"h-rand-small-{k}", True, alien_sorted(rng, rng.randint(4, 12), 4, letters)))
for k in range(5):
    tests.append(case(f"h-rand-{k}", True, alien_sorted(rng, rng.randint(30, 200), 6, "abcdefghijklmnopqrstuvwxyz")))
for k in range(3):
    w = alien_sorted(rng, rng.randint(30, 200), 6, "abcdefghijklmnop")
    i = rng.randrange(len(w) - 1)
    w[i], w[i + 1] = w[i + 1], w[i]
    tests.append(case(f"h-rand-swapped-{k}", True, w))

# Large valid dictionary: all-pairs comparison is ~3e7 pairs here.
tests.append(case("h-large", True, alien_sorted(rng, 8000, 12, "abcdefghijklmnopqrstuvwxyz")))
# Large dictionary whose only flaw is a prefix violation near the end.
w = alien_sorted(rng, 3000, 10, "abcdefghijklmnopqrstuvwxyz")
w.insert(2900, w[2899] + "zz")
tests.append(case("h-large-prefix-flaw", True, w))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
