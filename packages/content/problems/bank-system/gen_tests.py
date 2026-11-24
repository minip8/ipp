"""Regenerates tests.json deterministically from the Python reference solution.

Every operation sequence is replayed against an independent model (dict keyed by account number)
and the two must agree before anything is written.
"""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


class Model:
    def __init__(self, balance):
        self.acc = {i + 1: b for i, b in enumerate(balance)}

    def transfer(self, a, b, amt):
        if a in self.acc and b in self.acc and self.acc[a] >= amt:
            self.acc[a] -= amt
            self.acc[b] += amt
            return True
        return False

    def deposit(self, a, amt):
        if a in self.acc:
            self.acc[a] += amt
            return True
        return False

    def withdraw(self, a, amt):
        if a in self.acc and self.acc[a] >= amt:
            self.acc[a] -= amt
            return True
        return False

    def getBalance(self, a):
        return self.acc.get(a, -1)


def run(cls, bal, ops):
    obj = cls(list(bal))
    return [getattr(obj, m)(*a) for m, a in ops]


def case(id, hidden, bal, ops, explanation=None):
    expected = run(mod.Bank, bal, ops)
    assert expected == run(Model, bal, ops), id
    t = {"id": id, "hidden": hidden, "ctorArgs": [bal],
         "calls": [{"method": m, "args": a} for m, a in ops], "expected": expected}
    if explanation: t["explanation"] = explanation
    return t


def random_ops(rng, count, n, max_amt):
    def acct():
        r = rng.random()
        if r < 0.85:
            return rng.randint(1, n)
        return rng.choice([0, -1, n + 1, -n, 10**9, -10**9])

    ops = []
    for _ in range(count):
        r = rng.random()
        amt = rng.randint(0, max_amt)
        if r < 0.35:
            ops.append(("transfer", [acct(), acct(), amt]))
        elif r < 0.55:
            ops.append(("deposit", [acct(), amt]))
        elif r < 0.8:
            ops.append(("withdraw", [acct(), amt]))
        else:
            ops.append(("getBalance", [acct()]))
    return ops


T = lambda a, b, x: ("transfer", [a, b, x])
D = lambda a, x: ("deposit", [a, x])
W = lambda a, x: ("withdraw", [a, x])
B = lambda a: ("getBalance", [a])
rng = random.Random(2043)
for _ in range(300):
    n = rng.randint(1, 5)
    bal = [rng.randint(0, 50) for _ in range(n)]
    ops = random_ops(rng, 40, n, 60)
    assert run(mod.Bank, bal, ops) == run(Model, bal, ops)

tests = [
    case("s1", False, [10, 100, 20], [W(3, 10), T(5, 1, 20), T(2, 1, 100), D(2, 5), T(2, 3, 6), B(1), B(0)],
         "Accounts are numbered from 1; a transfer fails when the source is short."),
    case("s2", False, [0], [W(1, 0), W(1, 1), D(1, 7), T(1, 1, 7), T(1, 1, 8), B(1)],
         "Zero amounts are fine; a self-transfer succeeds if the balance covers it and changes nothing."),
    case("h-big-balances", True, [10**12, 10**12, 0],
         [T(1, 3, 10**9), D(3, 10**9), T(2, 3, 10**9), B(3), B(1), W(1, 10**9), B(1), W(3, 3 * 10**9), W(3, 3 * 10**9), B(3)],
         "Balances exceed 32-bit range."),
    case("h-invalid-accounts", True, [5, 5],
         [D(0, 1), D(3, 1), D(-1, 1), W(-2, 1), T(1, -1, 1), T(-1, 1, 1), T(1, 3, 1), B(-1), B(3), B(1), B(2)],
         "Negative account numbers must not wrap around (Python lists accept negative indices)."),
    case("h-atomic-transfer", True, [100], [T(1, 2, 50), B(1), T(1, 0, 50), B(1)],
         "A transfer to an invalid account must not debit the source."),
    case("h-exact-balance", True, [7, 0], [W(1, 7), B(1), D(1, 3), T(1, 2, 3), B(1), B(2), T(2, 1, 4), B(2)]),
    case("h-last-account", True, [1, 2, 3, 4, 5], [B(5), W(5, 5), D(5, 9), T(5, 1, 9), B(1), B(5), B(6)]),
]
for k, (cnt, n, amt) in enumerate([(30, 2, 20), (80, 4, 50), (200, 10, 100), (500, 50, 10**9), (800, 3, 30)]):
    bal = [rng.randint(0, amt) for _ in range(n)]
    tests.append(case(f"h-rand-{k}", True, bal, random_ops(rng, cnt, n, amt)))
n = 10000
bal = [rng.randint(0, 10**12) for _ in range(3000)] + [0] * (n - 3000)
tests.append(case("h-large", True, bal, random_ops(rng, 1500, n, 10**9)))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
