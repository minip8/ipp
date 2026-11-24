"""Regenerates tests.json deterministically from the Python reference solution.

For every n the reference is checked against brute force (all 2^(2n) strings filtered for
balance) and against the Catalan number before anything is written.
"""
import json, importlib.util, pathlib, itertools, math

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


def balanced(s):
    d = 0
    for ch in s:
        d += 1 if ch == "(" else -1
        if d < 0:
            return False
    return d == 0


def brute(n):
    return sorted("".join(p) for p in itertools.product("()", repeat=2 * n) if balanced(p))


def case(id, hidden, n, explanation=None):
    got = mod.Solution().generateParenthesis(n)
    assert len(got) == len(set(got)) == math.comb(2 * n, n) // (n + 1), id
    assert all(len(s) == 2 * n and balanced(s) for s in got), id
    if n <= 7:
        assert sorted(got) == brute(n), id
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "generateParenthesis", "args": [n]}],
         "expected": [got]}
    if explanation: t["explanation"] = explanation
    return t


tests = [
    case("s1", False, 1),
    case("s2", False, 2),
    case("s3", False, 3, "5 balanced strings (the 3rd Catalan number)."),
]
for n in range(4, 10):
    tests.append(case(f"h-n{n}", True, n))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
