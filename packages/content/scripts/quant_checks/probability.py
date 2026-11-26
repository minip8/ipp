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
