"""Regenerates tests.json deterministically from the Python reference solution."""
import json, random, importlib.util, pathlib, sys

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
sys.setrecursionlimit(100000)
LIM = 2**31

def trunc_div(a, b):
    q = abs(a) // abs(b)
    return q if (a < 0) == (b < 0) else -q

CAP = 2**30

def build(n_ops, rng, p_combine=0.5):
    """Random valid RPN with exactly n_ops operators. Values are tracked as it is built: every
    intermediate value stays below 2^30 in magnitude and no divisor is zero. Returns (tokens, value)."""
    stack, literals_left = [], n_ops + 1   # entries are (tokens, value)
    while literals_left or len(stack) > 1:
        if len(stack) >= 2 and (not literals_left or rng.random() < p_combine):
            tb, b = stack.pop()
            ta, a = stack.pop()
            ops = ["+", "-", "*"] + (["/"] if b else [])
            rng.shuffle(ops)
            for op in ops:
                v = {"+": a + b, "-": a - b, "*": a * b, "/": trunc_div(a, b) if b else None}[op]
                if abs(v) < CAP:   # one of + / - always qualifies (same signs: -, opposite: +)
                    break
            stack.append((ta + tb + [op], v))
        else:
            x = rng.randint(-200, 200)
            stack.append(([str(x)], x)); literals_left -= 1
    return stack[0]

def case(id, hidden, tokens, explanation=None):
    exp = mod.Solution().evalRPN(list(tokens))
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "evalRPN", "args": [tokens]}], "expected": [exp]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(150)
for _ in range(2000):
    toks, v = build(rng.randint(0, 6), rng)
    assert mod.Solution().evalRPN(toks) == v, (toks, v)

tests = [
    case("s1", False, ["3", "4", "+", "2", "*"], "(3 + 4) * 2"),
    case("s2", False, ["8", "3", "-"], "The earlier value is the left operand: 8 - 3."),
    case("s3", False, ["7", "-2", "/"], "7 / -2 = -3.5, truncated toward zero."),
    case("s4", False, ["15", "7", "1", "1", "+", "-", "/", "3", "*", "2", "1", "1", "+", "+", "-"], "((15 / (7 - (1 + 1))) * 3) - (2 + (1 + 1))"),
    case("h-single", True, ["-42"]),
    case("h-neg-div-pos", True, ["-7", "2", "/"]),
    case("h-neg-div-neg", True, ["-7", "-2", "/"]),
    case("h-div-small", True, ["1", "3", "/"]),
    case("h-neg-zero-div", True, ["-1", "3", "/"], "-1 / 3 truncates to 0 (floor division gives -1)."),
    case("h-sub-order", True, ["2", "10", "-"]),
    case("h-div-order", True, ["3", "12", "/"]),
    case("h-negative-literals", True, ["-5", "-6", "*", "-1", "-"]),
    case("h-big-mult", True, ["200", "200", "*", "200", "*", "200", "*", "-200", "+"]),
]
for k, n in enumerate([5, 20, 100, 500]):
    toks, v = build(n, rng)
    assert mod.Solution().evalRPN(toks) == v
    tests.append(case(f"h-rand-{k}", True, toks))
for k, n in enumerate([3000, 4999]):
    toks, v = build(n, rng)
    assert mod.Solution().evalRPN(toks) == v
    tests.append(case(f"h-large-{k}", True, toks))
deep = [str(rng.randint(1, 200)) for _ in range(5000)] + [rng.choice("+-") for _ in range(4999)]
tests.append(case("h-large-deep-stack", True, deep, "All numbers first: the stack grows to 5000."))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
