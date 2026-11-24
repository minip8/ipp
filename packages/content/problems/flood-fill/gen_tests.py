"""Regenerates tests.json deterministically from the Python reference solution.

Cross-checked against a brute-force fixpoint fill on small random images.
"""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


def brute(image, sr, sc, color):
    rows, cols = len(image), len(image[0])
    old = image[sr][sc]
    mark = {(sr, sc)}
    changed = True
    while changed:
        changed = False
        for r in range(rows):
            for c in range(cols):
                if (r, c) not in mark and image[r][c] == old and any(
                        (r + dr, c + dc) in mark for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                    mark.add((r, c)); changed = True
    return [[color if (r, c) in mark else image[r][c] for c in range(cols)] for r in range(rows)]


def case(id, hidden, image, sr, sc, color, explanation=None):
    got = mod.Solution().floodFill([row[:] for row in image], sr, sc, color)
    if len(image) * len(image[0]) <= 400:
        assert got == brute(image, sr, sc, color), id
    t = {"id": id, "hidden": hidden, "ctorArgs": [],
         "calls": [{"method": "floodFill", "args": [image, sr, sc, color]}], "expected": [got]}
    if explanation: t["explanation"] = explanation
    return t


def rand_image(rng, rows, cols, colours):
    return [[rng.randrange(colours) for _ in range(cols)] for _ in range(rows)]


rng = random.Random(733)
for _ in range(300):
    img = rand_image(rng, rng.randint(1, 6), rng.randint(1, 6), rng.randint(1, 3))
    sr, sc = rng.randrange(len(img)), rng.randrange(len(img[0]))
    col = rng.randrange(4)
    assert mod.Solution().floodFill([r[:] for r in img], sr, sc, col) == brute(img, sr, sc, col)

tests = [
    case("s1", False, [[1, 1, 0], [1, 0, 2], [1, 1, 1]], 0, 0, 5,
         "All 1s connected to (0,0) become 5; the 0 at (1,1) blocks nothing because the path goes around it."),
    case("s2", False, [[3, 3], [3, 3]], 1, 0, 3, "The new colour equals the old one, so nothing changes."),
    case("s3", False, [[1, 0, 1], [0, 1, 0], [1, 0, 1]], 1, 1, 9, "Diagonal pixels are not connected."),
    case("h-single-pixel", True, [[0]], 0, 0, 7),
    case("h-same-colour-big", True, [[4] * 40 for _ in range(40)], 17, 23, 4,
         "Same colour: a fill that uses the colour as its visited mark must return early."),
    case("h-row", True, [[2, 2, 2, 5, 2, 2]], 0, 1, 0),
    case("h-column", True, [[1], [1], [0], [1]], 3, 0, 6),
    case("h-ring", True, [[1, 1, 1, 1], [1, 0, 0, 1], [1, 0, 0, 1], [1, 1, 1, 1]], 1, 2, 1,
         "Filling the inner 0s with 1 makes the whole grid 1."),
]
for k in range(8):
    img = rand_image(rng, rng.randint(1, 20), rng.randint(1, 20), rng.choice([2, 2, 3, 5]))
    tests.append(case(f"h-rand-{k}", True, img, rng.randrange(len(img)), rng.randrange(len(img[0])), rng.randrange(6)))

# Snake-shaped region: very long single path, breaks recursion-depth-limited DFS.
R = C = 150
snake = [[1] * C for _ in range(R)]
for r in range(1, R, 2):
    for c in range(C):
        snake[r][c] = 0
    snake[r][C - 1 if r % 4 == 1 else 0] = 1
tests.append(case("h-snake", True, snake, 0, 0, 2))
# Big mostly-uniform image with random holes.
big = [[0 if rng.random() < 0.3 else 7 for _ in range(130)] for _ in range(130)]
big[65][65] = 7
tests.append(case("h-large-random", True, big, 65, 65, 8))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
