"""Regenerates tests.json deterministically from the Python reference solution.

Every sequence is replayed against a brute-force model (two stacks, one page moved per step).
"""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


class Model:
    def __init__(self, home): self.cur, self.bk, self.fw = home, [], []
    def visit(self, u): self.bk.append(self.cur); self.cur = u; self.fw = []
    def back(self, s):
        for _ in range(s):
            if not self.bk: break
            self.fw.append(self.cur); self.cur = self.bk.pop()
        return self.cur
    def forward(self, s):
        for _ in range(s):
            if not self.fw: break
            self.bk.append(self.cur); self.cur = self.fw.pop()
        return self.cur


def run(cls, home, ops):
    obj = cls(home)
    return [getattr(obj, m)(*a) for m, a in ops]


def case(id, hidden, home, ops, explanation=None):
    expected = run(mod.BrowserHistory, home, ops)
    assert expected == run(Model, home, ops), id
    t = {"id": id, "hidden": hidden, "ctorArgs": [home],
         "calls": [{"method": m, "args": a} for m, a in ops], "expected": expected}
    if explanation: t["explanation"] = explanation
    return t


def url(rng, pool=None):
    if pool: return rng.choice(pool)
    return "".join(rng.choice("abcdefghijklmnopqrstuvwxyz") for _ in range(rng.randint(1, 6))) + ".io"


def random_ops(rng, n, max_steps, visit_p=0.35, pool=None):
    ops = []
    for _ in range(n):
        r = rng.random()
        if r < visit_p: ops.append(("visit", [url(rng, pool)]))
        elif r < visit_p + (1 - visit_p) / 2: ops.append(("back", [rng.randint(1, max_steps)]))
        else: ops.append(("forward", [rng.randint(1, max_steps)]))
    return ops


V = lambda u: ("visit", [u])
B = lambda s: ("back", [s])
F = lambda s: ("forward", [s])
rng = random.Random(1472)

for _ in range(300):
    ops = random_ops(rng, 40, 4, pool=["a", "b", "c"])
    assert run(mod.BrowserHistory, "h", ops) == run(Model, "h", ops)

tests = [
    case("s1", False, "home.io", [V("a.io"), V("b.io"), V("c.io"), B(1), B(1), F(1), V("d.io"), F(2), B(2), B(7)],
         "Visiting d.io from b.io discards c.io; back(7) stops at the homepage."),
    case("s2", False, "x.io", [B(3), F(3), V("x.io"), B(1), F(5)],
         "Moving with nothing to move to stays put; revisiting the same URL adds a new entry."),
    case("h-visit-truncates", True, "h", [V("a"), V("b"), V("c"), V("d"), B(3), V("e"), F(1), F(100), B(1), B(1), F(2)],
         "After back(3) and visit(e), b/c/d are gone: forward must stop at e."),
    case("h-truncate-then-grow", True, "h", [V("a"), V("b"), V("c"), B(2), V("x"), V("y"), V("z"), V("w"), B(10), F(3), F(10)],
         "History shrinks then grows past its old length (array reuse)."),
    case("h-only-home", True, "home", [B(1), F(1), B(100), F(100)]),
    case("h-same-url", True, "a", [V("a"), V("a"), B(1), B(1), B(1), F(2)]),
]
for k, (n, ms) in enumerate([(40, 2), (100, 3), (300, 5), (600, 20)]):
    tests.append(case(f"h-rand-{k}", True, url(rng), random_ops(rng, n, ms)))
tests.append(case("h-rand-few-urls", True, "a", random_ops(rng, 500, 4, pool=["a", "b", "c"])))
tests.append(case("h-long-history", True, "start.io",
                  [V(f"p{i}.io") for i in range(1500)] + random_ops(rng, 1200, 100, visit_p=0.1)))
tests.append(case("h-large", True, "home.io", random_ops(rng, 2400, 100, visit_p=0.5)))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
