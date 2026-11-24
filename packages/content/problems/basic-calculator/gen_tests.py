"""Regenerates tests.json deterministically from the Python reference solution.
Expressions are generated as trees whose values are tracked independently of the reference parser."""
import json, random, importlib.util, pathlib, sys

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
sys.setrecursionlimit(20000)
CAP = 2**31

def tdiv(a, b):
    q = abs(a) // abs(b)
    return q if (a < 0) == (b < 0) else -q

PREC = {"+": 1, "-": 1, "*": 2, "/": 2}

class Gen:
    def __init__(self, rng, spaces=0.2, max_lit=1000):
        self.rng, self.spaces, self.max_lit = rng, spaces, max_lit
    def sp(self):
        return " " * self.rng.randint(1, 2) if self.rng.random() < self.spaces else ""
    def node(self, size, depth=0):
        """Returns (text, value, prec, starts_with_unary). prec 3 = atom."""
        r = self.rng
        if size <= 1 or depth > 150:
            v = r.randint(0, self.max_lit); return str(v), v, 3, False
        if r.random() < 0.08:  # parenthesised sub-expression, sometimes negated with a unary minus
            t, v, _, _ = self.node(size - 1, depth + 1)
            if r.random() < 0.4:
                inner = t if t.isdigit() else "(" + t + ")"
                return "(" + self.sp() + "-" + self.sp() + inner + self.sp() + ")", -v, 3, False
            return "(" + self.sp() + t + self.sp() + ")", v, 3, False
        for _ in range(20):
            op = r.choice("+-*/")
            ls = r.randint(1, size - 1)
            lt, lv, lp, _ = self.node(ls, depth + 1)
            rt, rv, rp, _ = self.node(size - ls, depth + 1)
            if op == "/" and rv == 0: continue
            v = {"+": lv + rv, "-": lv - rv, "*": lv * rv, "/": tdiv(lv, rv) if rv else 0}[op]
            if abs(v) >= CAP: continue
            p = PREC[op]
            if lp < p: lt = "(" + lt + ")"
            if rp <= p: rt = "(" + rt + ")"  # left-assoc: equal precedence on the right needs parens
            return lt + self.sp() + op + self.sp() + rt, v, p, False
        v = r.randint(0, self.max_lit); return str(v), v, 3, False

def case(id, hidden, s, value=None, explanation=None):
    exp = mod.Solution().calculate(s)
    if value is not None: assert exp == value, (s[:200], exp, value)
    assert -CAP <= exp < CAP and len(s) <= 20000
    t = {"id": id, "hidden": hidden, "ctorArgs": [], "calls": [{"method": "calculate", "args": [s]}], "expected": [exp]}
    if explanation: t["explanation"] = explanation
    return t

rng = random.Random(772)
g = Gen(rng)
for _ in range(3000):
    t, v, _, _ = g.node(rng.randint(1, 12))
    assert mod.Solution().calculate(t) == v, (t, v)

tests = [
    case("s1", False, "1 + 2 * 3", 7),
    case("s2", False, "(1+2)*3", 9),
    case("s3", False, "-(5 - 12) / 2", 3, "-(-7) = 7, then 7 / 2 = 3."),
    case("s4", False, "2*(3+(4-10)/4)", 4, "(4 - 10) / 4 truncates to -1."),
    case("h-example-5", True, "100 - 2 * 3 - 4", 90),
    case("h-single", True, "0", 0),
    case("h-spaces", True, "   42   ", 42),
    case("h-left-assoc-sub", True, "8 - 3 - 2", 3),
    case("h-left-assoc-div", True, "12 / 3 * 2", 8),
    case("h-left-assoc-div2", True, "100 / 10 / 5", 2),
    case("h-trunc-neg", True, "(0 - 7) / 2", -3, "Floor division would give -4."),
    case("h-trunc-small", True, "(1 - 2) / 3", 0),
    case("h-unary-start-term", True, "-3 * 2 + 10", 4, "Unary minus negates the first term, -3 * 2."),
    case("h-unary-in-parens", True, "2 - (-4 + 1)", 5),
    case("h-nested-unary", True, "-(-(-(1)))", -1),
    case("h-deep-parens", True, "(" * 100 + "7" + ")" * 100, 7),
    case("h-int-max", True, "2147483647", 2147483647),
    case("h-int-min", True, "-2147483647 - 1", -2147483648),
    case("h-mult-chain", True, "2*3*4*5*6*7*8*9*10*11*12", 479001600),
    case("h-sub-paren", True, "10 - (2 - 3)", 11),
    case("h-div-chain-paren", True, "100 / (10 / 5)", 50),
]
for k, size in enumerate([5, 15, 40, 120, 400]):
    t, v, _, _ = g.node(size)
    tests.append(case(f"h-rand-{k}", True, t, v))
for k, size in enumerate([2500, 3000]):
    gg = Gen(rng, spaces=0.05, max_lit=99)
    while True:
        t, v, _, _ = gg.node(size)
        if len(t) <= 20000: break
    tests.append(case(f"h-large-{k}", True, t, v))
long_sum = " + ".join(str(rng.randint(0, 1000)) for _ in range(3000))
tests.append(case("h-large-flat-sum", True, long_sum, eval(long_sum)))
(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
