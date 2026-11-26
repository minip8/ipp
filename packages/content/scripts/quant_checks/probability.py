"""Checks for quiz/probability: each recomputes an answer by a different route from the explanation.

Exact checks enumerate a sample space, run a recurrence or dynamic programme, or solve a linear
system with Fractions; the rest simulate with the seeded `simulate` helper.
"""

from __future__ import annotations

import itertools
import math
from collections import Counter
from fractions import Fraction
from functools import lru_cache

from . import check, simulate

# ---------------------------------------------------------------- helpers

DIE = range(1, 7)


def dice(n: int):
    """Every ordered outcome of n fair dice (each equally likely)."""
    return itertools.product(DIE, repeat=n)


def prob(event, outcomes) -> Fraction:
    """Fraction of equally likely outcomes satisfying event."""
    hits = total = 0
    for o in outcomes:
        total += 1
        hits += bool(event(o))
    return Fraction(hits, total)


def solve(a: list[list[Fraction]], b: list[Fraction]) -> list[Fraction]:
    """Exact Gauss-Jordan elimination for a square system a x = b."""
    n = len(a)
    m = [list(map(Fraction, row)) + [Fraction(rhs)] for row, rhs in zip(a, b)]
    for col in range(n):
        piv = next(r for r in range(col, n) if m[r][col] != 0)
        m[col], m[piv] = m[piv], m[col]
        p = m[col][col]
        m[col] = [x / p for x in m[col]]
        for r in range(n):
            if r != col and m[r][col] != 0:
                f = m[r][col]
                m[r] = [x - f * y for x, y in zip(m[r], m[col])]
    return [m[r][n] for r in range(n)]


def binom_pmf(n: int, k: int, p: Fraction) -> Fraction:
    return math.comb(n, k) * p**k * (1 - p) ** (n - k)


# ---------------------------------------------------------------- counting


@check("prob-counting-001")
def _():
    four = prob(lambda o: 6 in o, dice(4))
    # 24 rolls of a pair: distribution of "seen a double six yet", step by step
    none = Fraction(1)
    for _ in range(24):
        none = none * prob(lambda o: o != (6, 6), dice(2))
    assert four == Fraction(671, 1296)
    return "a" if four > 1 - none else ("b" if four < 1 - none else "c")


@check("prob-counting-002")
def _():
    n, distinct = 1, Fraction(1)
    while 1 - distinct <= Fraction(1, 2):
        distinct *= Fraction(365 - n, 365)
        n += 1
    return n


@check("prob-counting-003")
def _():
    # sum over rank multisets (as sorted rank tuples) of the number of suit choices
    hits = total = 0
    for ranks in itertools.combinations_with_replacement(range(13), 5):
        counts = Counter(ranks)
        if max(counts.values()) > 4:
            continue
        ways = math.prod(math.comb(4, c) for c in counts.values())
        total += ways
        if sorted(counts.values()) == [1, 1, 1, 2]:
            hits += ways
    assert total == math.comb(52, 5)
    return Fraction(hits, total)


@check("prob-counting-004")
def _():
    return prob(lambda p: all(p[i] != i for i in range(5)), itertools.permutations(range(5)))


@check("prob-counting-005")
def _():
    outcomes = Counter(tuple(sorted(o)) for o in dice(3))
    assert len(outcomes) == 56
    assert outcomes[(1, 2, 3)] == 6 and outcomes[(1, 1, 2)] == 3 and outcomes[(1, 1, 1)] == 1
    kinds = Counter(len(set(k)) for k in outcomes)
    assert kinds == {1: 6, 2: 30, 3: 20}


@check("prob-counting-006")
def _():
    good = total = 0
    for b_pos in itertools.combinations(range(12), 5):
        total += 1
        lead, ok = 0, True
        for i in range(12):
            lead += -1 if i in b_pos else 1
            if lead <= 0:
                ok = False
                break
        good += ok
    return Fraction(good, total)


@check("prob-counting-007")
def _():
    # dynamic programme on the number of distinct faces seen so far
    dist = {0: Fraction(1)}
    for _ in range(10):
        nxt: dict[int, Fraction] = {}
        for seen, p in dist.items():
            nxt[seen] = nxt.get(seen, 0) + p * Fraction(seen, 6)
            if seen < 6:
                nxt[seen + 1] = nxt.get(seen + 1, 0) + p * Fraction(6 - seen, 6)
        dist = nxt
    return dist[6]


@check("prob-counting-008")
def _():
    sixth = Fraction(1, 6)
    probs = {
        c: sum(binom_pmf(n, k, sixth) for k in range(need, n + 1))
        for c, n, need in (("a", 6, 1), ("b", 12, 2), ("c", 18, 3))
    }
    assert probs["a"] > probs["b"] > probs["c"]
    return max(probs, key=probs.get)


@check("prob-counting-009")
def _():
    for d in (365, 10_000, 2**32):
        n = 1
        distinct = 1.0
        while distinct > 0.5:
            distinct *= 1 - n / d
            n += 1
        approx = math.sqrt(2 * math.log(2) * d)
        assert abs(n - approx) / approx < 0.05, (d, n, approx)


# ---------------------------------------------------------------- conditional probability and Bayes


def conditional(event, given, outcomes) -> Fraction:
    hits = cond = 0
    for o in outcomes:
        if given(o):
            cond += 1
            hits += bool(event(o))
    return Fraction(hits, cond)


@check("prob-conditional-001")
def _():
    return conditional(
        lambda o: o.count("H") == 2, lambda o: "T" in o, itertools.product("HT", repeat=3)
    )


@check("prob-conditional-002")
def _():
    cards = [("R", "R"), ("B", "B"), ("R", "B")]
    faces = [(c, side) for c in cards for side in (0, 1)]  # six equally likely (card, face up)
    return conditional(lambda f: f[0][1 - f[1]] == "R", lambda f: f[0][f[1]] == "R", faces)


@check("prob-conditional-003")
def _():
    # a population of 100,000 people, counted (natural frequencies)
    sick = 100_000 // 1000
    healthy = 100_000 - sick
    true_pos = Fraction(99, 100) * sick
    false_pos = Fraction(5, 100) * healthy
    return true_pos / (true_pos + false_pos)


@check("prob-conditional-004")
def _():
    # sample space: (coin, ten tosses); weight each coin's all-heads sequence
    joint = []
    for coin in range(1000):
        p_heads = Fraction(1) if coin == 0 else Fraction(1, 2)
        joint.append(Fraction(1, 1000) * p_heads**10)
    return joint[0] / sum(joint)


@check("prob-conditional-005")
def _():
    # enumerate weather and each friend's truthfulness
    num = den = Fraction(0)
    for rain in (True, False):
        for truthful in itertools.product((True, False), repeat=3):
            w = Fraction(1, 4) if rain else Fraction(3, 4)
            for t in truthful:
                w *= Fraction(2, 3) if t else Fraction(1, 3)
            says_yes = all((rain if t else not rain) for t in truthful)
            if says_yes:
                den += w
                num += w if rain else 0
    return num / den


def poly_integral_01(coeffs: list[Fraction]) -> Fraction:
    return sum(c / (i + 1) for i, c in enumerate(coeffs))


def poly_mul(a: list[Fraction], b: list[Fraction]) -> list[Fraction]:
    out = [Fraction(0)] * (len(a) + len(b) - 1)
    for i, x in enumerate(a):
        for j, y in enumerate(b):
            out[i + j] += x * y
    return out


def poly_pow(a: list[Fraction], n: int) -> list[Fraction]:
    out = [Fraction(1)]
    for _ in range(n):
        out = poly_mul(out, a)
    return out


@check("prob-conditional-006")
def _():
    p = [Fraction(0), Fraction(1)]
    q = [Fraction(1), Fraction(-1)]
    # the likelihood of one particular sequence with 7 heads and 3 tails, times the uniform prior
    like = poly_mul(poly_pow(p, 7), poly_pow(q, 3))
    return poly_integral_01(poly_mul(like, p)) / poly_integral_01(like)


@check("prob-conditional-007")
def _():
    fams = list(itertools.product("BG", repeat=2))
    assert conditional(lambda f: f == ("B", "B"), lambda f: "B" in f, fams) == Fraction(1, 3)
    # meet a random child: sample space (family, which child)
    meets = [(f, i) for f in fams for i in (0, 1)]
    assert conditional(lambda m: m[0] == ("B", "B"), lambda m: m[0][m[1]] == "B", meets) == Fraction(1, 2)


@check("prob-conditional-008")
def _():
    # (a) knowing host: weight (prize, host's door) given we picked door 1
    def host_knows(prize):
        options = [d for d in (2, 3) if d != prize]
        return {d: Fraction(1, len(options)) for d in options}

    def host_random(prize):
        return {2: Fraction(1, 2), 3: Fraction(1, 2)}

    def p_switch_wins(host):
        num = den = Fraction(0)
        for prize in (1, 2, 3):
            w = Fraction(1, 3) * host(prize).get(3, 0)
            if prize == 3:  # door 3 opened and showed the prize: not our observation
                continue
            den += w
            num += w if prize == 2 else 0
        return num / den

    assert p_switch_wins(host_knows) == Fraction(2, 3)
    assert p_switch_wins(host_random) == Fraction(1, 2)


@check("prob-conditional-009")
def _():
    a = [(18, 20), (48, 80)]
    b = [(68, 80), (11, 20)]
    for (ra, na), (rb, nb) in zip(a, b):
        assert Fraction(ra, na) > Fraction(rb, nb)
    assert sum(r for r, _ in a) == 66 and sum(n for _, n in a) == 100
    assert sum(r for r, _ in b) == 79 and sum(n for _, n in b) == 100


def independent_events(a, b, outcomes) -> bool:
    outcomes = list(outcomes)
    pa = prob(a, outcomes)
    pb = prob(b, outcomes)
    return prob(lambda o: a(o) and b(o), outcomes) == pa * pb


def independent_variables(x, y, outcomes) -> bool:
    outcomes = list(outcomes)
    xs = {x(o) for o in outcomes}
    ys = {y(o) for o in outcomes}
    return all(
        independent_events(lambda o, u=u: x(o) == u, lambda o, v=v: y(o) == v, outcomes)
        for u in xs
        for v in ys
    )


@check("prob-conditional-010")
def _():
    two = list(dice(2))
    first_even = lambda o: o[0] % 2 == 0  # noqa: E731
    picked = set()
    if independent_events(first_even, lambda o: sum(o) == 7, two):
        picked.add("a")
    if independent_events(first_even, lambda o: sum(o) == 8, two):
        picked.add("b")
    if independent_events(first_even, lambda o: sum(o) % 2 == 0, two):
        picked.add("c")
    if independent_events(lambda o: max(o) == 6, lambda o: min(o) == 1, two):
        picked.add("d")
    if independent_variables(lambda o: o[0] + o[1], lambda o: o[0] * o[1], two):
        picked.add("e")
    ev = [first_even, lambda o: o[1] % 2 == 0, lambda o: sum(o) % 2 == 0]
    mutual = prob(lambda o: all(e(o) for e in ev), two) == math.prod(prob(e, two) for e in ev)
    pairwise = all(independent_events(ev[i], ev[j], two) for i, j in ((0, 1), (0, 2), (1, 2)))
    assert pairwise
    if mutual:
        picked.add("f")
    return picked


@check("prob-conditional-011")
def _():
    # any distribution with disjoint A, B of these probabilities: P(A and B) = 0 != 0.12
    pa, pb = Fraction(3, 10), Fraction(4, 10)
    return "a" if pa * pb == 0 else "b"


# ---------------------------------------------------------------- expectation and linearity


@check("prob-expectation-001")
def _():
    outcomes = list(dice(2))
    return Fraction(sum(max(o) for o in outcomes), len(outcomes))


@check("prob-expectation-002")
def _():
    # exact distribution of the number of fixed points of a random permutation of 100,
    # via derangement numbers: P(k fixed) = C(n, k) D(n - k) / n!
    n = 100
    der = [1, 0]
    for m in range(2, n + 1):
        der.append((m - 1) * (der[m - 1] + der[m - 2]))
    total = sum(math.comb(n, k) * der[n - k] for k in range(n + 1))
    assert total == math.factorial(n)
    mean = Fraction(sum(k * math.comb(n, k) * der[n - k] for k in range(n + 1)), total)
    return mean


@check("prob-expectation-003")
def _():
    # first-step equations E[s] = 1 + (s/6) E[s] + ((6-s)/6) E[s+1], E[6] = 0, solved as a system
    n = 7
    a = [[Fraction(0)] * n for _ in range(n)]
    b = [Fraction(0)] * n
    for s in range(n):
        a[s][s] = Fraction(1)
        if s == 6:
            continue
        a[s][s] -= Fraction(s, 6)
        a[s][s + 1] -= Fraction(6 - s, 6)
        b[s] = Fraction(1)
    return solve(a, b)[0]


@check("prob-expectation-004")
def _():
    @lru_cache(maxsize=None)
    def changes(r: int, b: int, last: str) -> Fraction:
        """Expected colour changes still to come, with r red and b black left after a `last` card."""
        if r + b == 0:
            return Fraction(0)
        out = Fraction(0)
        if r:
            out += Fraction(r, r + b) * ((last == "B") + changes(r - 1, b, "R"))
        if b:
            out += Fraction(b, r + b) * ((last == "R") + changes(r, b - 1, "B"))
        return out

    return Fraction(26, 52) * changes(25, 26, "R") + Fraction(26, 52) * changes(26, 25, "B")


@check("prob-expectation-005")
def _():
    # P(first ace at position k) by drawing non-aces one at a time
    mean = Fraction(0)
    no_ace_yet = Fraction(1)
    for k in range(1, 50):
        left = 52 - (k - 1)
        mean += k * no_ace_yet * Fraction(4, left)
        no_ace_yet *= Fraction(left - 4, left)
    assert no_ace_yet == 0
    return mean


@check("prob-expectation-006")
def _():
    total = Fraction(0)
    for k in range(1, 400):
        total += Fraction(min(2**k, 2**20), 2**k)
    return float(total)


@check("prob-expectation-007")
def _():
    pairs = math.comb(30, 2)
    assert Fraction(pairs, 365) == Fraction(435, 365)
    distinct = math.prod(Fraction(365 - i, 365) for i in range(30))
    assert abs(float(1 - distinct) - 0.706) < 0.001


@check("prob-expectation-008")
def _():
    def trial(rng):
        s, n = 0.0, 0
        while s <= 1:
            s += rng.random()
            n += 1
        return n

    sim = simulate(trial)
    assert abs(sim.mean - math.e) < 4 * sim.stderr, sim


@check("prob-expectation-009")
def _():
    import random

    rng = random.Random(7)
    statements = {
        "a": lambda E: E(lambda x, y: x + y) == E(lambda x, y: x) + E(lambda x, y: y),
        "b": lambda E: E(lambda x, y: x * y) == E(lambda x, y: x) * E(lambda x, y: y),
        "c": lambda E: E(lambda x, y: Fraction(1, x)) == 1 / E(lambda x, y: x),
        "d": lambda E: E(lambda x, y: max(x, y)) >= max(E(lambda x, y: x), E(lambda x, y: y)),
        "e": lambda E: E(lambda x, y: x * x) >= E(lambda x, y: x) ** 2,
        "f": lambda E: E(lambda x, y: x - y) <= 0 or E(lambda x, y: Fraction(x > y)) > Fraction(1, 2),
    }
    violated = set()
    for _ in range(3000):
        support = [(rng.randint(1, 6), rng.randint(1, 6)) for _ in range(rng.randint(1, 4))]
        weights = [rng.randint(1, 5) for _ in support]
        tot = sum(weights)

        def E(f, support=support, weights=weights, tot=tot):
            return sum(Fraction(w, tot) * f(x, y) for (x, y), w in zip(support, weights))

        for k, st in statements.items():
            if not st(E):
                violated.add(k)
    return set(statements) - violated


# ---------------------------------------------------------------- discrete distributions


@check("prob-discrete-001")
def _():
    return prob(lambda o: o.count("H") == 5, itertools.product("HT", repeat=10))


@check("prob-discrete-002")
def _():
    # Poisson process as a fine binomial limit: n slots, each with probability 2/n of a call
    exact = 1 - sum(math.exp(-2) * 2**k / math.factorial(k) for k in range(2))
    n = 2_000_000
    p = 2 / n
    binom = 1 - (1 - p) ** n - n * p * (1 - p) ** (n - 1)
    assert abs(binom - exact) < 1e-5
    return exact


@check("prob-discrete-003")
def _():
    exact = Fraction(math.comb(100, 50), 2**100)
    options = {"a": 0.5, "b": 0.25, "c": 0.08, "d": 0.01}
    return min(options, key=lambda k: abs(options[k] - float(exact)))


@check("prob-discrete-004")
def _():
    hits = Fraction(0)
    for o in itertools.product((0, 1), repeat=5):
        w = math.prod(Fraction(1, 3) if t else Fraction(2, 3) for t in o)
        if sum(o) % 2 == 0:
            hits += w
    return hits


@check("prob-discrete-005")
def _():
    @lru_cache(maxsize=None)
    def win(a: int, b: int) -> Fraction:
        """P(A takes the series) when A needs a more wins and B needs b more."""
        if a == 0:
            return Fraction(1)
        if b == 0:
            return Fraction(0)
        return Fraction(3, 5) * win(a - 1, b) + Fraction(2, 5) * win(a, b - 1)

    return win(4, 4)


@check("prob-discrete-006")
def _():
    return Fraction(sum(math.comb(400, k) for k in range(220, 401)), 2**400)


@check("prob-discrete-007")
def _():
    def trial(rng):
        while True:  # rejection: rerun histories in which a 5 came before the first 6
            n = 0
            while True:
                n += 1
                r = rng.randint(1, 6)
                if r == 6:
                    return n
                if r == 5:
                    break

    return simulate(trial, n=300_000)


@check("prob-discrete-008")
def _():
    def pois(lam, k):
        return math.exp(-lam) * lam**k / math.factorial(k)

    for b in range(8):
        for n in range(8):
            joint = pois(10, b + n) * math.comb(b + n, b) * 0.3**b * 0.7**n
            assert math.isclose(joint, pois(3, b) * pois(7, n), rel_tol=1e-12)


@check("prob-discrete-009")
def _():
    for p in (Fraction(1, 10), Fraction(1, 2), Fraction(5, 7)):
        ht, th = p * (1 - p), (1 - p) * p
        assert ht == th
        accept = ht + th
        assert 2 / accept == 1 / (p * (1 - p))  # two tosses per geometric attempt
    assert abs(1 / (0.1 * 0.9) - 11.1) < 0.02

    def trial(rng):
        tosses = 0
        while True:
            a, b = rng.random() < 0.1, rng.random() < 0.1
            tosses += 2
            if a != b:
                return tosses

    sim = simulate(trial, n=50_000)
    assert abs(sim.mean - 1 / 0.09) < 4 * sim.stderr


# ---------------------------------------------------------------- continuous and geometric


@check("prob-continuous-001")
def _():
    return simulate(lambda r: abs(r.random() - r.random()))


@check("prob-continuous-002")
def _():
    return simulate(lambda r: abs(r.uniform(0, 60) - r.uniform(0, 60)) <= 15)


@check("prob-continuous-003")
def _():
    def trial(r):
        a, b = r.random(), r.random()
        return a * a - 4 * b >= 0

    return simulate(trial, n=600_000)


@check("prob-continuous-004")
def _():
    def trial(r):
        x, y = sorted((r.random(), r.random()))
        pieces = (x, y - x, 1 - y)
        a, b, c = sorted(pieces)
        return a + b > c

    return simulate(trial)


@check("prob-continuous-005")
def _():
    def trial(r):
        a, b = r.expovariate(1.0), r.expovariate(1.0)
        start = min(a, b)
        me = start + r.expovariate(1.0)
        return me > max(a, b)

    return simulate(trial)


@check("prob-continuous-006")
def _():
    def frac_below(q):
        def trial(r):
            x, y = r.expovariate(3.0), r.expovariate(3.0)
            return x / (x + y) <= q

        return simulate(trial, n=100_000)

    candidates = {
        "a": lambda q: q,  # uniform
        "b": lambda q: 3 * q**2 - 2 * q**3,  # Beta(2, 2)
        "c": lambda q: 2 / math.pi * math.asin(math.sqrt(q)),  # Beta(1/2, 1/2)
    }
    fits = set(candidates)
    for q in (0.1, 0.25, 0.4):
        sim = frac_below(q)
        fits = {k for k in fits if abs(sim.mean - candidates[k](q)) < 4 * sim.stderr}
    assert len(fits) == 1, fits
    return fits.pop()


@check("prob-continuous-007")
def _():
    import random

    def method_a(r):
        rad, th = r.random(), 2 * math.pi * r.random()
        return rad * math.cos(th), rad * math.sin(th)

    def method_b(r):
        rad, th = math.sqrt(r.random()), 2 * math.pi * r.random()
        return rad * math.cos(th), rad * math.sin(th)

    def method_c(r):
        while True:
            x, y = r.uniform(-1, 1), r.uniform(-1, 1)
            if x * x + y * y <= 1:
                return x, y

    def method_d(r):
        rad, th = max(r.random(), r.random()), 2 * math.pi * r.random()
        return rad * math.cos(th), rad * math.sin(th)

    def method_e(r):
        x = r.uniform(-1, 1)
        h = math.sqrt(1 - x * x)
        return x, r.uniform(-h, h)

    # targets for a uniform point: P(r <= 1/2) = 1/4, P(x > 0.8) = segment area / pi
    t = math.acos(0.8)
    seg = (2 * t - math.sin(2 * t)) / 2 / math.pi
    tests = [(lambda p: p[0] ** 2 + p[1] ** 2 <= 0.25, 0.25), (lambda p: p[0] > 0.8, seg)]
    good = set()
    n = 100_000
    for name, method in zip("abcde", (method_a, method_b, method_c, method_d, method_e)):
        ok = True
        for test, target in tests:
            rng = random.Random(11)
            hits = sum(test(method(rng)) for _ in range(n))
            se = math.sqrt(target * (1 - target) / n)
            ok &= abs(hits / n - target) < 4 * se
        if ok:
            good.add(name)
    return good


@check("prob-continuous-008")
def _():
    import random

    rng = random.Random(5)
    t, buses = 0.0, []
    while t < 2_000_000:
        t += rng.expovariate(1 / 10)
        buses.append(t)
    import bisect

    waits, gaps = [], []
    for _ in range(100_000):
        u = rng.uniform(1000, 1_999_000)
        i = bisect.bisect_right(buses, u)
        waits.append(buses[i] - u)
        gaps.append(buses[i] - buses[i - 1])
    assert abs(sum(waits) / len(waits) - 10) < 0.2
    assert abs(sum(gaps) / len(gaps) - 20) < 0.3


@check("prob-continuous-009")
def _():
    import random

    rng = random.Random(9)
    n = 200_000
    side = math.sqrt(3)

    def endpoints():
        a, b = rng.uniform(0, 2 * math.pi), rng.uniform(0, 2 * math.pi)
        return 2 * abs(math.sin((a - b) / 2))

    def radius():
        d = rng.random()
        return 2 * math.sqrt(1 - d * d)

    def midpoint():
        while True:
            x, y = rng.uniform(-1, 1), rng.uniform(-1, 1)
            if x * x + y * y <= 1:
                return 2 * math.sqrt(1 - x * x - y * y)

    for gen, target in ((endpoints, 1 / 3), (radius, 1 / 2), (midpoint, 1 / 4)):
        p = sum(gen() > side for _ in range(n)) / n
        assert abs(p - target) < 0.005, (gen.__name__, p)


@check("prob-continuous-010")
def _():
    def trial(r):
        return -math.log(1 - r.random()) / 2.0 <= 0.5

    sim = simulate(trial, n=100_000)
    assert abs(sim.mean - (1 - math.exp(-1))) < 4 * sim.stderr


# ---------------------------------------------------------------- variance, covariance, correlation


def moments(pmf: dict) -> tuple[Fraction, Fraction]:
    """Mean and variance of a pmf {value: probability}."""
    mean = sum(p * x for x, p in pmf.items())
    return mean, sum(p * (x - mean) ** 2 for x, p in pmf.items())


def convolve(a: dict, b: dict) -> dict:
    out: dict = {}
    for x, p in a.items():
        for y, q in b.items():
            out[x + y] = out.get(x + y, 0) + p * q
    return out


DIE_PMF = {k: Fraction(1, 6) for k in DIE}


@check("prob-variance-001")
def _():
    return moments(DIE_PMF)[1]


@check("prob-variance-002")
def _():
    # X, Y independent fair +-1 (variance 1 each): enumerate
    pmf = convolve({1: Fraction(1, 2), -1: Fraction(1, 2)}, {-1: Fraction(1, 2), 1: Fraction(1, 2)})
    var = moments(pmf)[1]
    return {Fraction(0): "a", Fraction(1): "b", Fraction(2): "d"}[var]


@check("prob-variance-003")
def _():
    outcomes = list(dice(2))
    n = len(outcomes)
    ex = Fraction(sum(o[0] for o in outcomes), n)
    es = Fraction(sum(sum(o) for o in outcomes), n)
    cov = Fraction(sum((o[0] - ex) * (sum(o) - es) for o in outcomes), n)
    vx = Fraction(sum((o[0] - ex) ** 2 for o in outcomes), n)
    vs = Fraction(sum((sum(o) - es) ** 2 for o in outcomes), n)
    return float(cov) / math.sqrt(vx * vs)


@check("prob-variance-004")
def _():
    total = math.comb(52, 13)
    pmf = {k: Fraction(math.comb(13, k) * math.comb(39, 13 - k), total) for k in range(14)}
    assert sum(pmf.values()) == 1
    return moments(pmf)[1]


@check("prob-variance-005")
def _():
    s_pmf: dict = {}
    sum_n = {0: Fraction(1)}
    for n in DIE:
        sum_n = convolve(sum_n, DIE_PMF)  # distribution of the sum of n dice
        for s, p in sum_n.items():
            s_pmf[s] = s_pmf.get(s, 0) + Fraction(1, 6) * p
    return moments(s_pmf)[1]


def psd3(a: Fraction, b: Fraction, c: Fraction) -> bool:
    """Is [[1,a,b],[a,1,c],[b,c,1]] positive semidefinite? (all principal minors >= 0)"""
    minors = [1 - a * a, 1 - b * b, 1 - c * c, 1 + 2 * a * b * c - a * a - b * b - c * c]
    return all(m >= 0 for m in minors)


@check("prob-variance-006")
def _():
    grid = [Fraction(k, 1000) for k in range(-1000, 1001)]
    return min(r for r in grid if psd3(r, r, r))


@check("prob-variance-007")
def _():
    rho = 0.5
    s = math.sqrt(1 - rho * rho)

    def trial(r):
        x, z = r.gauss(0, 1), r.gauss(0, 1)
        return x > 0 and rho * x + s * z > 0

    return simulate(trial)


@check("prob-variance-008")
def _():
    picked = set()
    # a: X uniform on {-1,0,1}, Y = X^2 is a counterexample
    xs = [-1, 0, 1]
    cov = Fraction(sum(x * x * x for x in xs), 3) - Fraction(sum(xs), 3) * Fraction(sum(x * x for x in xs), 3)
    assert cov == 0  # uncorrelated, yet Y is a function of X: a is false
    picked.add("b")  # independence => E[XY] = E[X]E[Y]; checked on dice
    outcomes = list(dice(2))
    assert Fraction(sum(a * b for a, b in outcomes), 36) == Fraction(7, 2) ** 2
    # c: exact on a lopsided joint distribution
    joint = {(1, 2): Fraction(1, 5), (2, 7): Fraction(2, 5), (4, 3): Fraction(2, 5)}

    def corr(f, g):
        ef = sum(p * f(*k) for k, p in joint.items())
        eg = sum(p * g(*k) for k, p in joint.items())
        c = sum(p * (f(*k) - ef) * (g(*k) - eg) for k, p in joint.items())
        vf = sum(p * (f(*k) - ef) ** 2 for k, p in joint.items())
        vg = sum(p * (g(*k) - eg) ** 2 for k, p in joint.items())
        return c * c / (vf * vg), c > 0  # squared correlation and its sign, exact

    if corr(lambda x, y: 2 * x + 3, lambda x, y: 5 * y - 1) == corr(lambda x, y: x, lambda x, y: y):
        picked.add("c")
    # d, e: smallest feasible Corr(X, Z) given the other two, from positive semidefiniteness
    grid = [Fraction(k, 1000) for k in range(-1000, 1001)]
    for key, r in (("d", Fraction(9, 10)), ("e", Fraction(1, 2))):
        lo = min(c for c in grid if psd3(r, r, c))
        if lo > 0:
            picked.add(key)
    # f: X normal, Y = S X with a random sign: uncorrelated, |X| = |Y|
    import random

    rng = random.Random(3)
    pairs = [(x, x * rng.choice((-1, 1))) for x in (rng.gauss(0, 1) for _ in range(100_000))]
    c = sum(x * y for x, y in pairs) / len(pairs)
    assert abs(c) < 0.02 and all(abs(x) == abs(y) for x, y in pairs)
    return picked


@check("prob-variance-009")
def _():
    xs = {-1: Fraction(1, 3), 0: Fraction(1, 3), 1: Fraction(1, 3)}
    exy = sum(p * x * x * x for x, p in xs.items())
    ex = sum(p * x for x, p in xs.items())
    ey = sum(p * x * x for x, p in xs.items())
    assert exy - ex * ey == 0
    assert ey == Fraction(2, 3)  # P(Y = 0) = 1/3, but P(Y = 0 | X = 0) = 1


@check("prob-variance-010")
def _():
    sigma2, rho = Fraction(1), Fraction(3, 10)
    for n in (1, 2, 10, 1000):
        cov = [[sigma2 if i == j else rho * sigma2 for j in range(n)] for i in range(n)] if n <= 10 else None
        formula = sigma2 / n + (1 - Fraction(1, n)) * rho * sigma2
        if cov is not None:
            assert sum(sum(row) for row in cov) / n**2 == formula
    assert abs(math.sqrt(0.3) - 0.55) < 0.01


# ---------------------------------------------------------------- symmetry and order statistics


@check("prob-symmetry-001")
def _():
    return simulate(lambda r: sorted(r.random() for _ in range(4))[1])


@check("prob-symmetry-002")
def _():
    n = 100

    @lru_cache(maxsize=None)
    def ok(i: int) -> Fraction:
        """P(last passenger gets their seat) when passenger i must choose among seat 1 and seats i+1..n."""
        free = 1 + (n - i)
        total = Fraction(1, free)  # picks seat 1: everyone after is seated correctly
        for j in range(i + 1, n):  # picks seat j: passenger j becomes the chooser
            total += Fraction(1, free) * ok(j)
        return total  # picking seat n contributes 0

    # passenger 1 chooses among all n seats, the same situation as ok(1)
    return ok(1)


@check("prob-symmetry-003")
def _():
    @lru_cache(maxsize=None)
    def p(aces: int, kings: int, others: int) -> Fraction:
        """P(all remaining aces come out before any king), drawing one card at a time."""
        if aces == 0:
            return Fraction(1)
        total = aces + kings + others
        out = Fraction(aces, total) * p(aces - 1, kings, others)
        if others:
            out += Fraction(others, total) * p(aces, kings, others - 1)
        return out  # drawing a king first fails

    return p(4, 4, 44)


@check("prob-symmetry-004")
def _():
    # count orderings: first k-1 cards non-aces, card k one of the other three aces, card k+1 the ace of spades
    good = 0
    for k in range(1, 50):
        good += math.perm(48, k - 1) * 3 * math.factorial(52 - k - 1)
    return Fraction(good, math.factorial(52))


@check("prob-symmetry-005")
def _():
    def trial(r):
        xs = [r.random() for _ in range(3)]
        return max(xs) - min(xs) <= 1 / 3

    return simulate(trial, n=300_000)


@check("prob-symmetry-006")
def _():
    outcomes = list(dice(2))
    e_min = Fraction(sum(min(o) for o in outcomes), 36)
    e_diff = Fraction(sum(abs(o[0] - o[1]) for o in outcomes), 36)
    assert e_min == Fraction(91, 36) and e_diff == Fraction(70, 36)
    return "a" if e_min > e_diff else ("b" if e_diff > e_min else "c")


@check("prob-symmetry-007")
def _():
    half = Fraction(1, 2)
    alice = {k: binom_pmf(11, k, half) for k in range(12)}
    bob = {k: binom_pmf(10, k, half) for k in range(11)}
    assert sum(pa * pb for a, pa in alice.items() for b, pb in bob.items() if a > b) == half


@check("prob-symmetry-008")
def _():
    n = 7
    total = Fraction(0)
    perms = list(itertools.permutations(range(n)))
    for p in perms:
        best = -1
        for x in p:
            if x > best:
                total += 1
                best = x
    assert total / len(perms) == sum(Fraction(1, k) for k in range(1, n + 1))
    h1000 = sum(1 / k for k in range(1, 1001))
    assert abs(h1000 - 7.485) < 0.01


# ---------------------------------------------------------------- first-step analysis and Markov chains


def pattern_states(patterns: list[str]) -> list[str]:
    """Every string shorter than the longest pattern that does not contain a pattern: the chain's states."""
    k = max(map(len, patterns))
    states = []
    for n in range(k):
        for s in itertools.product("HT", repeat=n):
            states.append("".join(s))
    return states


def step(state: str, toss: str, patterns: list[str]) -> str:
    """Append a toss; return the finished pattern, or the state to carry (the last k-1 tosses)."""
    s = state + toss
    for p in patterns:
        if s.endswith(p):
            return "!" + p
    k = max(map(len, patterns))
    return s[-(k - 1):] if k > 1 else ""


def expected_wait(pattern: str) -> Fraction:
    states = pattern_states([pattern])
    idx = {s: i for i, s in enumerate(states)}
    a = [[Fraction(0)] * len(states) for _ in states]
    b = [Fraction(1)] * len(states)
    for s, i in idx.items():
        a[i][i] += 1
        for t in "HT":
            nxt = step(s, t, [pattern])
            if not nxt.startswith("!"):
                a[i][idx[nxt]] -= Fraction(1, 2)
    return solve(a, b)[idx[""]]


def race(first: str, second: str) -> Fraction:
    """P(`first` appears before `second`) for fair tosses."""
    pats = [first, second]
    states = pattern_states(pats)
    idx = {s: i for i, s in enumerate(states)}
    a = [[Fraction(0)] * len(states) for _ in states]
    b = [Fraction(0)] * len(states)
    for s, i in idx.items():
        a[i][i] += 1
        for t in "HT":
            nxt = step(s, t, pats)
            if nxt == "!" + first:
                b[i] += Fraction(1, 2)
            elif not nxt.startswith("!"):
                a[i][idx[nxt]] -= Fraction(1, 2)
    return solve(a, b)[idx[""]]


@check("prob-first-step-001")
def _():
    def trial(r):
        t = 0
        while True:
            c = r.randrange(3)
            if c == 0:
                return t + 3
            t += c  # 1 or 2 hours, back at the start

    return simulate(trial, n=400_000)


@check("prob-first-step-002")
def _():
    return expected_wait("HTH")


@check("prob-first-step-003")
def _():
    hh, ht = expected_wait("HH"), expected_wait("HT")
    assert (hh, ht) == (6, 4)
    return "a" if hh > ht else ("b" if ht > hh else "c")


@check("prob-first-step-004")
def _():
    # states: your lead -1, 0, +1 (absorbing at -2, +2)
    p, q = Fraction(2, 5), Fraction(3, 5)
    leads = [-1, 0, 1]
    idx = {d: i for i, d in enumerate(leads)}
    a = [[Fraction(0)] * 3 for _ in leads]
    b = [Fraction(0)] * 3
    for d in leads:
        i = idx[d]
        a[i][i] += 1
        for move, w in ((1, p), (-1, q)):
            nd = d + move
            if nd == 2:
                b[i] += w
            elif nd != -2:
                a[i][idx[nd]] -= w
    return solve(a, b)[idx[0]]


@check("prob-first-step-005")
def _():
    corners = list(itertools.product((0, 1), repeat=3))
    idx = {c: i for i, c in enumerate(corners)}
    target = (1, 1, 1)
    a = [[Fraction(0)] * 8 for _ in corners]
    b = [Fraction(0)] * 8
    for c in corners:
        i = idx[c]
        a[i][i] = Fraction(1)
        if c == target:
            continue
        b[i] = Fraction(1)
        for axis in range(3):
            nb = list(c)
            nb[axis] ^= 1
            a[i][idx[tuple(nb)]] -= Fraction(1, 3)
    return solve(a, b)[idx[(0, 0, 0)]]


@check("prob-first-step-006")
def _():
    dist = [Fraction(1), Fraction(0), Fraction(0), Fraction(0)]
    for _ in range(7):
        dist = [sum(dist[j] * Fraction(1, 3) for j in range(4) if j != i) for i in range(4)]
    return dist[0]


@check("prob-first-step-007")
def _():
    return race("THH", "HHH")


@check("prob-first-step-008")
def _():
    def overlap_formula(p):
        return sum(2**j for j in range(1, len(p) + 1) if p[:j] == p[-j:])

    for p in ("HHT", "HTH", "HHH", "THH", "HTHH", "HHTT"):
        assert expected_wait(p) == overlap_formula(p), p
    assert (expected_wait("HHT"), expected_wait("HTH"), expected_wait("HHH")) == (8, 10, 14)
