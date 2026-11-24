"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


def brute(m):
    R, C, best = len(m), len(m[0]), 0
    for r in range(R):
        for c in range(C):
            k = 1
            while r + k <= R and c + k <= C and all(m[i][j] == "1" for i in range(r, r + k) for j in range(c, c + k)):
                best = max(best, k)
                k += 1
    return best * best


def case(id, hidden, m, explanation=None, check=True):
    got = mod.Solution().maximalSquare(list(m))
    if check:
        assert got == brute(m), m
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "maximalSquare", "args": [m]}],
         "expected": [got]}
    if explanation: t["explanation"] = explanation
    return t


def grid(rng, R, C, p):
    return ["".join("1" if rng.random() < p else "0" for _ in range(C)) for _ in range(R)]


def plant(rng, m, side):
    """Overwrite a random side x side block with ones."""
    m = [list(r) for r in m]
    r0, c0 = rng.randint(0, len(m) - side), rng.randint(0, len(m[0]) - side)
    for r in range(r0, r0 + side):
        for c in range(c0, c0 + side):
            m[r][c] = "1"
    return ["".join(r) for r in m]


rng = random.Random(221)
for _ in range(300):
    m = grid(rng, rng.randint(1, 7), rng.randint(1, 7), rng.choice([0.3, 0.6, 0.85]))
    assert mod.Solution().maximalSquare(list(m)) == brute(m)

tests = [
    case("s1", False, ["10100", "10111", "11111", "10010"], "Rows 1-2, columns 2-3 form a 2x2 block of ones."),
    case("s2", False, ["01", "10"]),
    case("s3", False, ["000"]),
    case("h-single-one", True, ["1"]),
    case("h-single-zero", True, ["0"]),
    case("h-row", True, ["1111111"], "A single row can only hold a 1x1 square."),
    case("h-column", True, ["1", "1", "1"]),
    case("h-full", True, ["1111", "1111", "1111"]),
    case("h-diagonal-hole", True, ["1111", "1111", "1101", "1111"],
         "The hole at (2,2) limits squares ending at (3,3); top/left alone would miss it."),
    case("h-two-mins", True, ["11100", "11110", "11111", "01111", "00111"]),
    case("h-checker", True, ["".join("1" if (r + c) % 2 else "0" for c in range(9)) for r in range(9)]),
]
for k, (R, C, p) in enumerate([(5, 8, 0.7), (12, 12, 0.8), (20, 15, 0.9), (30, 40, 0.75)]):
    tests.append(case(f"h-rand-{k}", True, grid(rng, R, C, p), check=R * C <= 400))
tests.append(case("h-planted", True, plant(rng, grid(rng, 60, 80, 0.6), 23), check=False))
tests.append(case("h-large-ones", True, ["1" * 300] * 300, "A 300x300 square: area 90000.", check=False))
tests.append(case("h-large-planted", True, plant(rng, grid(rng, 250, 300, 0.85), 41), check=False))
tests.append(case("h-tall-thin", True, ["11"] * 300, check=False))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
