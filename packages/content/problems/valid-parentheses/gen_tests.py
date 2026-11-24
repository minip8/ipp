"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

def solve(s):
    return mod.Solution().isValid(s)

def brute(s):
    prev = None
    while prev != s:
        prev = s
        s = s.replace("()", "").replace("[]", "").replace("{}", "")
    return s == ""

def case(id, hidden, s, explanation=None):
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "isValid", "args": [s]}],
         "expected": [solve(s)]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(20)
for _ in range(5000):
    s = "".join(rng.choice("()[]{}") for _ in range(rng.randint(1, 10)))
    assert solve(s) == brute(s), s

def balanced(n):
    """Random balanced string of n pairs."""
    out, stack = [], []
    opens = n
    while opens or stack:
        if opens and (not stack or rng.random() < 0.5):
            c = rng.choice("([{"); out.append(c); stack.append(c); opens -= 1
        else:
            out.append({"(": ")", "[": "]", "{": "}"}[stack.pop()])
    return "".join(out)

tests = [
    case("s1", False, "{[]()}"),
    case("s2", False, "([)]", "The ( is closed by ] before the [ is closed: the pairs cross."),
    case("s3", False, "((", "Opened but never closed."),
    case("s4", False, "])", "The first ] has nothing to match."),
    case("h-single-open", True, "("),
    case("h-single-close", True, "}"),
    case("h-pair", True, "[]"),
    case("h-counts-ok-order-bad", True, "[(])", "Equal counts per type, but crossing."),
    case("h-close-first", True, ")("),
    case("h-nested-deep", True, "{[(" * 5 + ")]}" * 5),
    case("h-wrong-type", True, "(]"),
    case("h-trailing-open", True, "()[]{}("),
]
for k, n in enumerate([3, 10, 50, 500]):
    b = balanced(n)
    tests.append(case(f"h-rand-ok-{k}", True, b))
    i = rng.randrange(len(b)); swapped = b[:i] + rng.choice([c for c in "()[]{}" if c != b[i]]) + b[i + 1:]
    tests.append(case(f"h-rand-mut-{k}", True, swapped))
big = balanced(20000)
tests.append(case("h-large-ok", True, big))
tests.append(case("h-large-deep", True, "(" * 25000 + ")" * 25000))
tests.append(case("h-large-unclosed", True, "[" * 25000 + "]" * 24999 + "("))
tests.append(case("h-large-late-cross", True, big[:-2] + big[-1] + big[-2] if big[-1] != big[-2] else big + ")"))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
