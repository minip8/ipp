"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib, copy

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def brute(iv):
    """Union over a doubled integer grid: point 2x is coordinate x, 2x+1 is the gap after it."""
    hi = max(e for _, e in iv)
    cover = [False] * (2 * hi + 2)
    for s, e in iv:
        for p in range(2 * s, 2 * e + 1): cover[p] = True
    out, p = [], 0
    while p < len(cover):
        if cover[p]:
            q = p
            while q + 1 < len(cover) and cover[q + 1]: q += 1
            out.append([p // 2, q // 2]); p = q + 1
        else:
            p += 1
    return out

def case(id, hidden, iv, explanation=None):
    exp = mod.Solution().merge(copy.deepcopy(iv))
    if max(e for _, e in iv) <= 5000: assert exp == brute(iv)
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "merge", "args": [iv]}], "expected": [exp]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(56)
def gen(n, span, maxlen):
    out = []
    for _ in range(n):
        s = rng.randint(0, span); out.append([s, min(span, s + rng.randint(0, maxlen))])
    return out
for _ in range(3000):
    iv = gen(rng.randint(1, 6), 12, 4)
    assert mod.Solution().merge(copy.deepcopy(iv)) == brute(iv), iv

tests = [
    case("s1", False, [[8, 10], [1, 3], [2, 6], [15, 18]]),
    case("s2", False, [[1, 4], [4, 5]], "Touching intervals merge."),
    case("s3", False, [[1, 10], [2, 3], [4, 5]], "Intervals inside [1, 10] disappear."),
    case("s4", False, [[5, 5], [1, 2]]),
    case("h-single", True, [[0, 1000000]]),
    case("h-gap-of-one", True, [[1, 3], [4, 6]], "3 and 4 are adjacent integers, but the intervals don't touch."),
    case("h-contained-last", True, [[1, 10], [2, 3]], "Taking the later interval's end would shrink [1, 10]."),
    case("h-identical", True, [[2, 4], [2, 4], [2, 4]]),
    case("h-points", True, [[3, 3], [3, 3], [4, 4]]),
    case("h-chain", True, [[4, 5], [1, 2], [3, 4], [2, 3]]),
    case("h-reverse-sorted", True, [[9, 10], [7, 8], [5, 6], [3, 4], [1, 2]]),
]
for k, (n, span, ml) in enumerate([(10, 50, 5), (100, 1000, 20), (1000, 5000, 10), (2000, 5000, 3)]):
    tests.append(case(f"h-rand-{k}", True, gen(n, span, ml)))
tests.append(case("h-large-sparse", True, gen(5000, 10**6, 60)))
tests.append(case("h-large-one-blob", True, gen(4000, 10**6, 2000)))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
