"""Regenerates tests.json deterministically from the Python reference solution.

Every operation sequence is replayed against a brute-force model (a plain string and an index)
and the two must agree before anything is written.
"""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


class Model:
    def __init__(self):
        self.s, self.p = "", 0

    def addText(self, t):
        self.s = self.s[:self.p] + t + self.s[self.p:]
        self.p += len(t)

    def deleteText(self, k):
        d = min(k, self.p)
        self.s = self.s[:self.p - d] + self.s[self.p:]
        self.p -= d
        return d

    def cursorLeft(self, k):
        self.p = max(0, self.p - k)
        return self.s[max(0, self.p - 10):self.p]

    def cursorRight(self, k):
        self.p = min(len(self.s), self.p + k)
        return self.s[max(0, self.p - 10):self.p]


def run(cls, ops):
    obj = cls()
    return [getattr(obj, m)(*a) for m, a in ops]


def case(id, hidden, ops, explanation=None, check=True):
    expected = run(mod.TextEditor, ops)
    if check:
        assert expected == run(Model, ops), id
    t = {"id": id, "hidden": hidden, "ctorArgs": [],
         "calls": [{"method": m, "args": a} for m, a in ops], "expected": expected}
    if explanation: t["explanation"] = explanation
    return t


def word(rng, lo, hi, alphabet="abcdefghijklmnopqrstuvwxyz"):
    return "".join(rng.choice(alphabet) for _ in range(rng.randint(lo, hi)))


def random_ops(rng, n, max_text=8, max_k=12, weights=(0.3, 0.2, 0.25, 0.25)):
    ops = []
    for _ in range(n):
        r = rng.random()
        if r < weights[0]:
            ops.append(("addText", [word(rng, 1, max_text)]))
        elif r < weights[0] + weights[1]:
            ops.append(("deleteText", [rng.randint(1, max_k)]))
        elif r < weights[0] + weights[1] + weights[2]:
            ops.append(("cursorLeft", [rng.randint(1, max_k)]))
        else:
            ops.append(("cursorRight", [rng.randint(1, max_k)]))
    return ops


A = lambda t: ("addText", [t])
D = lambda k: ("deleteText", [k])
L = lambda k: ("cursorLeft", [k])
R = lambda k: ("cursorRight", [k])
rng = random.Random(2296)
for _ in range(400):
    ops = random_ops(rng, 50, max_text=4, max_k=6)
    assert run(mod.TextEditor, ops) == run(Model, ops)

tests = [
    case("s1", False, [A("interview"), D(4), A("nal"), L(3), A("x"), R(100), L(20), D(5), A("ab"), R(9)],
         "Each cursor move returns up to 10 characters to the left of the new cursor position."),
    case("s2", False, [A("abc"), L(1), D(1), R(1), D(10), A("z"), L(1)],
         "Deleting removes characters to the left of the cursor only; text after the cursor survives."),
    case("h-empty", True, [D(1), L(5), R(5), A("q"), D(40), R(1), L(1)]),
    case("h-exactly-ten", True, [A("abcdefghij"), L(1), R(1), A("k"), L(1), R(40)],
         "Exactly 10 characters, then 11: only the last 10 are returned."),
    case("h-insert-middle", True, [A("hello"), A("world"), L(5), A("_"), R(2), L(4), D(2), R(10), L(40)]),
    case("h-delete-across", True, [A("aaaa"), A("bbbb"), L(4), D(3), R(4), L(40), R(40), D(40), R(1)]),
    case("h-ping-pong", True, [A("x" * 40), A("y" * 40)] + [L(40), R(40)] * 10 + [L(37), A("abc"), R(3), L(1)]),
]
for k, (n, mt, mk) in enumerate([(30, 3, 5), (80, 5, 8), (200, 8, 12), (500, 12, 20), (800, 3, 40)]):
    tests.append(case(f"h-rand-{k}", True, random_ops(rng, n, mt, mk)))
tests.append(case("h-backspace-heavy", True, random_ops(rng, 1000, 20, 40, weights=(0.45, 0.35, 0.1, 0.1))))
# Large: build a ~48k-character document, then edit around its middle. O(L) per edit with a flat
# string copies tens of thousands of characters per call.
big = [A(word(rng, 40, 40)) for _ in range(1200)]           # 48k characters
big += [L(40) for _ in range(600)]                            # cursor to the middle
for _ in range(1000):
    big.append(rng.choice([A(word(rng, 1, 3)), D(rng.randint(1, 3)), L(rng.randint(1, 5)), R(rng.randint(1, 5))]))
tests.append(case("h-large-middle-edits", True, big))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
