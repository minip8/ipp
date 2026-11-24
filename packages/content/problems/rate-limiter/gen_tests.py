"""Regenerates tests.json deterministically from the Python reference solution.

Every sequence is replayed against a brute-force model (full list of accepted requests, counted
on each call) and both must agree. A fixed-window limiter (a common wrong answer) is checked
to disagree with the expected results on the burst test and on every random test.
"""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


class Model:
    def __init__(self, mx, w): self.mx, self.w, self.acc = mx, w, []
    def allow(self, c, t):
        n = sum(1 for cc, s in self.acc if cc == c and t - self.w < s <= t)
        if n < self.mx:
            self.acc.append((c, t)); return True
        return False


class FixedWindow:  # a common wrong answer
    def __init__(self, mx, w): self.mx, self.w, self.cnt = mx, w, {}
    def allow(self, c, t):
        key = (c, t // self.w)
        if self.cnt.get(key, 0) < self.mx:
            self.cnt[key] = self.cnt.get(key, 0) + 1; return True
        return False


def run(cls, mx, w, calls):
    obj = cls(mx, w)
    return [obj.allow(c, t) for c, t in calls]


def case(id, hidden, mx, w, calls, explanation=None):
    expected = run(mod.RateLimiter, mx, w, calls)
    assert expected == run(Model, mx, w, calls), id
    t = {"id": id, "hidden": hidden, "ctorArgs": [mx, w],
         "calls": [{"method": "allow", "args": [c, ts]} for c, ts in calls], "expected": expected}
    if explanation: t["explanation"] = explanation
    return t


def random_calls(rng, n, clients, max_gap, start=0):
    calls, now = [], start
    for _ in range(n):
        now += rng.choice([0, 0, rng.randint(0, max_gap)])
        calls.append((rng.choice(clients), now))
    return calls


rng = random.Random(4242)

for _ in range(300):
    mx, w = rng.randint(1, 4), rng.randint(1, 8)
    calls = random_calls(rng, 50, [1, 2, 3], 3)
    assert run(mod.RateLimiter, mx, w, calls) == run(Model, mx, w, calls)

tests = [
    case("s1", False, 2, 10, [(1, 1), (1, 5), (1, 8), (2, 8), (1, 11), (1, 14), (1, 15)],
         "The rejected request at 14 is not recorded, so at 15 only the request at 11 is in the window."),
    case("s2", False, 3, 1, [(7, 0), (7, 0), (7, 0), (7, 0), (7, 1), (7, 1)],
         "With a 1-second window only same-second requests count; at time 1 the budget is fresh."),
]
edge = [
    case("h-boundary-exact", True, 1, 100, [(5, 0), (5, 99), (5, 100), (5, 199), (5, 200)],
         "A request exactly windowSeconds old is outside the window."),
    case("h-rejected-not-counted", True, 2, 10, [(1, 0), (1, 1)] + [(1, t) for t in range(2, 10)] + [(1, 10), (1, 11), (1, 12)],
         "A stream of rejected requests must not extend the lockout."),
    case("h-fixed-window-burst", True, 3, 10, [(1, 7), (1, 8), (1, 9), (1, 10), (1, 11), (1, 12), (1, 17), (1, 18)],
         "Fixed windows would allow 3 more at time 10; a sliding window does not."),
    case("h-many-clients", True, 1, 5, [(c, 0) for c in range(50)] + [(c, 4) for c in range(50)] + [(c, 5) for c in range(50)]),
    case("h-big-ids-times", True, 2, 10**6, [(10**9, 10**9 - 10**6), (0, 10**9 - 10**6), (10**9, 10**9 - 1), (10**9, 10**9 - 1), (10**9, 10**9)]),
    case("h-max-one-window-one", True, 1, 1, [(3, t // 2) for t in range(40)]),
]
for t in edge[2:3]:
    assert run(FixedWindow, t["ctorArgs"][0], t["ctorArgs"][1], [tuple(c["args"]) for c in t["calls"]]) != t["expected"]
tests += edge
for k, (n, mx, w, nc, gap) in enumerate([(60, 2, 5, 2, 3), (150, 3, 20, 4, 6), (400, 5, 50, 10, 10), (800, 10, 100, 5, 5)]):
    calls = random_calls(rng, n, list(range(nc)), gap)
    t = case(f"h-rand-{k}", True, mx, w, calls)
    assert run(FixedWindow, mx, w, calls) != t["expected"]
    tests.append(t)
tests.append(case("h-hot-client", True, 50, 1000, random_calls(rng, 2000, [1, 1, 1, 2], 20)))
tests.append(case("h-large", True, 100, 5000, random_calls(rng, 2800, list(range(20)), 15, start=10**8)))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
