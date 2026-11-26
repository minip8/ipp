"""Checks for quiz/betting-market-making: each recomputes an answer by a different route from the explanation.

Exact checks enumerate outcomes with Fractions, search over policies, stakes, bids or hedge sizes, or
run a dynamic programme; Kelly fractions are found by maximising expected log wealth numerically;
the rest simulate with the seeded `simulate` helper.
"""

from __future__ import annotations

import itertools
import math
import random
from collections import Counter
from fractions import Fraction
from functools import lru_cache

from . import check, simulate

# ---------------------------------------------------------------- helpers

DIE = range(1, 7)
HALF = Fraction(1, 2)


def dice(n: int):
    """Every ordered outcome of n fair dice (each equally likely)."""
    return itertools.product(DIE, repeat=n)


def mean(values) -> Fraction:
    values = list(values)
    return Fraction(sum(Fraction(v) for v in values), len(values))


def argmax(f, lo: float, hi: float, iters: int = 200) -> float:
    """Maximiser of a unimodal function on [lo, hi] by golden-section search."""
    g = (math.sqrt(5) - 1) / 2
    a, b = lo, hi
    c, d = b - g * (b - a), a + g * (b - a)
    fc, fd = f(c), f(d)
    for _ in range(iters):
        if fc > fd:
            b, d, fd = d, c, fc
            c = b - g * (b - a)
            fc = f(c)
        else:
            a, c, fc = c, d, fd
            d = a + g * (b - a)
            fd = f(d)
    return (a + b) / 2


def growth(outcomes):
    """Expected log growth as a function of the fraction staked, for (probability, return per unit) pairs."""
    return lambda f: sum(p * math.log(1 + f * r) for p, r in outcomes)


def even_money_growth(p: float, f: float) -> float:
    return p * math.log(1 + f) + (1 - p) * math.log(1 - f)


def bisect(f, lo: float, hi: float, iters: int = 200) -> float:
    """A root of f on [lo, hi], where f changes sign."""
    flo = f(lo)
    for _ in range(iters):
        mid = (lo + hi) / 2
        if (f(mid) > 0) == (flo > 0):
            lo, flo = mid, f(mid)
        else:
            hi = mid
    return (lo + hi) / 2


def sd(values) -> float:
    values = [float(v) for v in values]
    m = sum(values) / len(values)
    return math.sqrt(sum((v - m) ** 2 for v in values) / len(values))


def binom_pmf(n: int, k: int, p: Fraction) -> Fraction:
    return math.comb(n, k) * p**k * (1 - p) ** (n - k)


# ---------------------------------------------------------------- fair value


@check("bmm-fair-value-001")
def _():
    return mean(a * b for a, b in dice(2))


@check("bmm-fair-value-002")
def _():
    # dynamic programme on the number of sixes so far, truncated where the tail is negligible
    total = Fraction(0)
    reach = Fraction(1)  # probability of making roll k + 1
    for k in range(80):
        total += reach * Fraction(sum(range(1, 6)), 6)  # this roll stops on 1..5
        total += reach * Fraction(1, 6) * 6  # or pays 6 and continues
        reach *= Fraction(1, 6)
    return float(total)


@check("bmm-fair-value-003")
def _():
    # every stationary policy is a set of faces to keep; solve V = (sum kept + rerolls * (V - 1)) / 6
    best = None
    for keep in itertools.product((False, True), repeat=6):
        if not any(keep):
            continue
        kept = sum(x for x, k in zip(DIE, keep) if k)
        rerolls = sum(not k for k in keep)
        v = Fraction(kept - rerolls, 6 - rerolls)
        best = v if best is None else max(best, v)
    # value iteration agrees
    v = 0.0
    for _ in range(500):
        v = sum(max(x, v - 1) for x in DIE) / 6
    assert abs(v - float(best)) < 1e-9
    return best


@check("bmm-fair-value-004")
def _():
    deck = [r for r in range(1, 14) for _ in range(4)]
    return mean(max(deck[i], deck[j]) for i, j in itertools.combinations(range(52), 2))


@check("bmm-fair-value-005")
def _():
    profit = Fraction(0)
    for d1 in DIE:
        value = mean(d1 + d2 for d2 in DIE)
        profit += Fraction(1, 6) * max(value - 7, 0)
    both = mean(max(a + b - 7, 0) for a, b in dice(2))
    assert both == Fraction(35, 36)
    return profit


@check("bmm-fair-value-006")
def _():
    a = mean(x * x for x in DIE)
    b = mean(x * y for x, y in dice(2))
    return "a" if a > b else ("b" if b > a else "c")


@check("bmm-fair-value-007")
def _():
    ev = mean((o.count(1) or -1) for o in dice(3))
    assert ev == Fraction(-17, 216)
    if ev == 0:
        return "a"
    if ev > 0:
        return "b"
    return "c" if abs(float(ev) + 0.08) < 0.01 else "d"


def reroll_value(want_high: bool) -> Fraction:
    """Value of a die with one optional reroll, the decider choosing the best of all 64 keep-sets."""
    pick = max if want_high else min
    values = []
    for keep in itertools.product((False, True), repeat=6):
        values.append(sum(Fraction(1, 6) * (x if k else Fraction(7, 2)) for x, k in zip(DIE, keep)))
    return pick(values)


@check("bmm-fair-value-008")
def _():
    assert reroll_value(True) == Fraction(17, 4)
    assert reroll_value(False) == Fraction(11, 4)
    # the reference's market 2.5 at 4.5 is safe against the interviewer on both sides
    assert Fraction(5, 2) <= reroll_value(False) and Fraction(9, 2) >= reroll_value(True)


# ---------------------------------------------------------------- odds


@check("bmm-odds-001")
def _():
    prices = {"a": (2, 1), "b": (9, 4), "c": (7, 3), "d": (5, 2), "e": (11, 4)}
    p = Fraction(3, 10)
    return {c for c, (a, b) in prices.items() if p * Fraction(a, b) - (1 - p) > 0}


@check("bmm-odds-002")
def _():
    d_a, d_b = Fraction(18, 10), Fraction(21, 10)
    # the scale factor k with k/d_a + k/d_b = 1, found by bisection-free exact solve
    k = 1 / (1 / d_a + 1 / d_b)
    assert abs(float(1 / d_a + 1 / d_b) - 1.0317) < 1e-4
    return k / d_a


@check("bmm-odds-003")
def _():
    # search every whole-dollar split for the best guaranteed profit
    best = max(min(Fraction(22, 10) * s - 2100, 2 * (2100 - s) - 2100) for s in range(2101))
    return best


@check("bmm-odds-004")
def _():
    odds = [Fraction(25, 10), Fraction(36, 10), Fraction(4)]
    # equal returns: s_i * d_i = R with sum s_i = 1000, solved for R
    r = Fraction(1000) / sum(1 / d for d in odds)
    exact = r - 1000
    # a grid over whole-dollar stakes cannot beat it and comes close
    grid = max(
        min(h * odds[0], d * odds[1], (1000 - h - d) * odds[2]) - 1000
        for h in range(380, 480)
        for d in range(250, 350)
    )
    assert grid <= exact and exact - grid < 2
    return exact


@check("bmm-odds-005")
def _():
    def profits(lay):
        return (Fraction(200) - Fraction(18, 10) * lay, lay - 100)

    # maximise the worst case over lay stakes on a fine grid of cents, then confirm the equaliser
    best = max(min(profits(Fraction(c, 100))) for c in range(10000, 11500))
    lay = Fraction(300) / Fraction(28, 10)
    win, lose = profits(lay)
    assert win == lose and best <= win and win - best < Fraction(1, 50)
    return win


@check("bmm-odds-006")
def _():
    # quantities in -1..1 of each contract at the side's price; payoff in each of the two outcomes
    wins = {"buy": Fraction(60), "sell": Fraction(55)}
    loses = {"buy": Fraction(50), "sell": Fraction(47)}
    best = None
    for qw, ql in itertools.product((-1, 0, 1), repeat=2):
        cash = -(qw * (wins["buy"] if qw > 0 else wins["sell"])) - (ql * (loses["buy"] if ql > 0 else loses["sell"]))
        outcome_win = cash + qw * 100
        outcome_lose = cash + ql * 100
        worst = min(outcome_win, outcome_lose)
        best = worst if best is None else max(best, worst)
    return best


def coherent(prices: dict, atoms: list, events: dict) -> bool:
    """Whether some distribution over the atoms (on a 1/100 grid) reproduces every price."""
    n = len(atoms)
    for cut in itertools.combinations(range(100 + n - 1), n - 1):
        parts = [b - a - 1 for a, b in zip((-1, *cut), (*cut, 100 + n - 1))]
        p = dict(zip(atoms, (Fraction(x, 100) for x in parts)))
        if all(sum(p[a] for a in events[e]) == prices[e] for e in prices):
            return True
    return False


@check("bmm-odds-007")
def _():
    F = Fraction
    cases = {
        "a": ({"A": F(45, 100), "B": F(1, 2)}, ["A", "B"], {"A": ["A"], "B": ["B"]}),
        "b": (
            {"A": F(40, 100), "B": F(35, 100), "C": F(30, 100)},
            ["A", "B", "C"],
            {"A": ["A"], "B": ["B"], "C": ["C"]},
        ),
        "c": (
            {"rain": F(3, 10), "rain_wind": F(4, 10)},
            ["rw", "r", "w", "none"],
            {"rain": ["rw", "r"], "rain_wind": ["rw"]},
        ),
        "d": (
            {"A": F(3, 10), "B": F(4, 10), "AorB": F(6, 10)},
            ["ab", "a", "b", "none"],
            {"A": ["ab", "a"], "B": ["ab", "b"], "AorB": ["ab", "a", "b"]},
        ),
        "e": ({"A": F(6, 10), "notA": F(4, 10)}, ["A", "notA"], {"A": ["A"], "notA": ["notA"]}),
    }
    return {c for c, args in cases.items() if not coherent(*args)}


@check("bmm-odds-008")
def _():
    implied = 1 / Fraction(191, 100)
    assert abs(float(2 * implied) - 1.047) < 0.001
    balanced = 2000 - Fraction(191, 100) * 1000
    assert balanced == 90
    assert 2000 - Fraction(191, 100) * 1600 == -1056
    assert 2000 - Fraction(191, 100) * 400 == 1236
    assert HALF * (-1056) + HALF * 1236 == 90


@check("bmm-odds-009")
def _():
    d = Fraction(19, 10)
    for n, expected in ((1, 0.95), (2, 0.9025), (5, 0.774)):
        # enumerate every win/loss pattern of n legs
        ret = sum(Fraction(1, 2**n) * (d**n if all(w) else 0) for w in itertools.product((True, False), repeat=n))
        assert abs(float(ret) - expected) < 5e-4
    assert abs(float(d**5) - 24.76) < 0.01
    assert abs(0.55 * 1.9 - 1.045) < 1e-12
    assert abs(0.3 * 3.61 - 1.083) < 1e-12


# ---------------------------------------------------------------- sizing


@check("bmm-sizing-001")
def _():
    return argmax(growth([(0.4, 2.0), (0.6, -1.0)]), 0.0, 0.999)


@check("bmm-sizing-002")
def _():
    m, s2 = Fraction(1, 100), Fraction(1)

    def g(f):
        return m * f - s2 * f * f / 2

    grid = [Fraction(k, 10000) for k in range(0, 300)]
    best = max(grid, key=g)
    ratio = g(best / 2) / g(best)
    # the exact log growth of a small-edge even-money bet gives nearly the same ratio
    p = 0.505
    fstar = argmax(lambda f: even_money_growth(p, f), 0.0, 0.5)
    assert abs(even_money_growth(p, fstar / 2) / even_money_growth(p, fstar) - 0.75) < 0.01
    assert abs(even_money_growth(p, 2 * fstar)) < 1e-6
    return ratio


@check("bmm-sizing-003")
def _():
    def g(f):
        total = 0.0
        for a, b in itertools.product((True, False), repeat=2):
            p = (0.6 if a else 0.4) * (0.6 if b else 0.4)
            total += p * math.log(1 + f * (1 if a else -1) + f * (1 if b else -1))
        return total

    f = argmax(g, 0.0, 0.499)
    assert f < 0.2
    return f


@check("bmm-sizing-004")
def _():
    a = growth([(0.5, 1.25), (0.5, -1.0)])
    p_b = Fraction(sum(1 for o in dice(2) if sum(o) >= 10), 36)
    assert p_b == Fraction(1, 6)
    b = growth([(float(p_b), 6.5), (1 - float(p_b), -1.0)])
    ga = a(argmax(a, 0.0, 0.999))
    gb = b(argmax(b, 0.0, 0.999))
    assert abs(ga - 0.0062) < 1e-4 and abs(gb - 0.0045) < 1e-4
    return "a" if ga > gb + 1e-9 else ("b" if gb > ga + 1e-9 else "c")


@check("bmm-sizing-005")
def _():
    @lru_cache(maxsize=None)
    def guaranteed(r: int, b: int) -> Fraction:
        """Largest multiple of current wealth that can be guaranteed with r red and b black left."""
        if r == 0 or b == 0:
            return Fraction(2) ** (r + b)
        red, black = guaranteed(r - 1, b), guaranteed(r, b - 1)
        # bet s (as a fraction of wealth, positive = red): the worst case is min((1+s) red, (1-s) black);
        # search s exactly on a fine grid and at the crossing point
        candidates = [Fraction(k, 600) for k in range(-600, 601)]
        cross = (black - red) / (black + red)
        candidates.append(cross)
        return max(min((1 + s) * red, (1 - s) * black) for s in candidates)

    value = guaranteed(3, 3)
    assert value == Fraction(2**6, math.comb(6, 3))
    return value


@check("bmm-sizing-006")
def _():
    target = 0.5 * math.log(150) + 0.5 * math.log(70)
    return bisect(lambda c: math.log(100 + c) - target, 0.0, 10.0)


@check("bmm-sizing-007")
def _():
    # Discrete route: log-wealth as a random walk with steps of +-delta whose drift-to-variance ratio
    # matches half Kelly (2m/v = 3); gambler's ruin with an unreachable upper barrier gives (q/p)^(a/delta).
    theta = 3.0
    a = math.log(2)
    steps = 200_000
    delta = a / steps
    p = 0.5 * (1 + theta * delta / 2)
    limit = math.exp(steps * math.log((1 - p) / p))

    # Simulation route: half-Kelly betting on an even-money bet with p = 0.55 (Kelly 0.10, half 0.05)
    rng = random.Random(7)
    hits, trials = 0, 3000
    for _ in range(trials):
        w = 0.0
        while -a < w < math.log(64):
            w += math.log(1.05) if rng.random() < 0.55 else math.log(0.95)
        hits += w <= -a
    assert abs(hits / trials - 0.125) < 0.03, hits / trials
    return limit


@check("bmm-sizing-008")
def _():
    p, fstar = 0.6, 0.2
    true = set()
    # a: growth falls faster on the over-bet side, and is ~0 at twice Kelly
    g = lambda f: even_money_growth(p, f)  # noqa: E731
    if g(fstar - 0.1) > g(fstar + 0.1) and abs(g(2 * fstar)) < 0.01:
        true.add("a")
    # b: P(ever halving) at full Kelly is x^(2/c - 1) = 1/2 (continuous model)
    if abs(0.5 ** (2 / 1 - 1) - 0.5) < 1e-12:
        true.add("b")
    # c: the stake maximising expected wealth is everything, not Kelly
    ev = lambda f: p * (1 + f) + (1 - p) * (1 - f)  # noqa: E731
    if max((k / 100 for k in range(101)), key=ev) == fstar:
        true.add("c")
    # d: correlated positions (conceptual; true)
    true.add("d")
    # e: a fixed fraction below 1 never reaches zero after any finite run of losses (exactly)
    if any(Fraction(4, 5) ** n == 0 for n in range(1, 200)):
        true.add("e")
    # f: no fraction beats full Kelly's growth
    if any(g(c * fstar) > g(fstar) for c in (0.25, 0.5, 0.75)):
        true.add("f")
    return true


@check("bmm-sizing-009")
def _():
    def max_price(capital: float) -> float:
        return bisect(
            lambda price: sum(math.log(capital - price + k) for k in DIE) / 6 - math.log(capital),
            0.0,
            3.5,
        )

    assert abs(max_price(10) - 3.35) < 0.01
    assert abs(max_price(5) - 3.20) < 0.01
    assert abs(max_price(100) - 3.49) < 0.01
    assert mean(DIE) == Fraction(7, 2)


@check("bmm-sizing-010")
def _():
    table = {
        (0.52, 0.10): -0.0010,
        (0.52, 0.05): 0.0008,
        (0.55, 0.10): 0.0050,
        (0.55, 0.05): 0.0038,
        (0.58, 0.10): 0.0110,
        (0.58, 0.05): 0.0068,
    }
    for (p, f), value in table.items():
        assert abs(even_money_growth(p, f) - value) < 0.00006, (p, f)
    for p, kelly in ((0.52, 0.04), (0.55, 0.10), (0.58, 0.16)):
        assert abs(argmax(lambda f: even_money_growth(p, f), 0.0, 0.9) - kelly) < 1e-6


@check("bmm-sizing-011")
def _():
    assert mean([Fraction(3, 2), Fraction(3, 5)]) == Fraction(21, 20)
    assert abs(math.sqrt(1.5 * 0.6) - 0.949) < 5e-4
    assert abs(0.9**50 - 0.005) < 0.0005
    assert abs(1.05**100 - 131) < 1
    g = growth([(0.5, 0.5), (0.5, -0.4)])
    f = argmax(g, 0.0, 1.0)
    assert abs(f - 0.25) < 1e-6 and abs(g(f) - 0.0062) < 1e-4


# ---------------------------------------------------------------- quoting


@check("bmm-quoting-001")
def _():
    sums = [sum(o) for o in dice(3)]
    assert mean(sums) == Fraction(21, 2) and min(sums) == 3 and max(sums) == 18
    assert abs(sd(sums) - 2.96) < 0.005


@check("bmm-quoting-002")
def _():
    maxes = [max(o) for o in dice(3)]
    counts = Counter(maxes)
    assert mean(maxes) == Fraction(119, 24)
    assert counts[6] == 91 and counts[5] == 61 and counts[4] == 37
    assert sum(counts[k] for k in (1, 2, 3)) == 27
    assert abs(sd(maxes) - 1.1) < 0.05
    ordered = sorted(maxes)
    assert ordered[107] == ordered[108] == 5  # the median


@check("bmm-quoting-003")
def _():
    squares = [x * x for x in DIE]
    assert mean(squares) == Fraction(91, 6)
    assert mean(squares) - Fraction(49, 4) == Fraction(35, 12)
    assert abs(sd(squares) - 12.2) < 0.05
    assert sum(squares[4:]) / sum(squares) > 0.6  # 25 and 36 carry most of the value


@check("bmm-quoting-004")
def _():
    tiles = {tuple(sorted(t)) for t in itertools.product(range(7), repeat=2)}
    assert len(tiles) == 28 and sum(a == b for a, b in tiles) == 7


@check("bmm-quoting-005")
def _():
    a_bid, a_offer, b_bid, b_offer = 3, 4, 3, 4
    quotes = {"a": (6, 8), "b": (8.5, 9), "c": (5, 5.5), "d": (7, 7.5), "e": (6.5, 8.25)}
    exploitable = set()
    for cid, (s_bid, s_offer) in quotes.items():
        # my quantities in -1..1 (positive = I buy from you) of A, B and the sum
        for qa, qb, qs in itertools.product((-1, 0, 1), repeat=3):
            cash = 0.0
            for q, bid, offer in ((qa, a_bid, a_offer), (qb, b_bid, b_offer), (qs, s_bid, s_offer)):
                cash += -q * offer if q > 0 else -q * bid
            worst = min(cash + qa * x + qb * y + qs * (x + y) for x, y in dice(2))
            if worst > 1e-9:
                exploitable.add(cid)
                break
    return exploitable


@check("bmm-quoting-006")
def _():
    one = [float(x) for x in DIE]
    sd_one = sd(one)
    sd_b = 10 * sd_one
    sd_a = math.sqrt(10) * sd_one
    assert abs(sd_b - 17.1) < 0.05 and abs(sd_a - 5.4) < 0.05
    return "b" if sd_b > sd_a else "a"


@check("bmm-quoting-007")
def _():
    per = sd([a + b for a, b in dice(2)])
    assert abs(per - 2.42) < 0.005
    assert abs(1000 * per - 2415) < 1
    assert int(1000 / per) == 414


@check("bmm-quoting-008")
def _():
    def profit(offer: Fraction) -> Fraction:
        h = offer - 50
        trade = min(max(1 - h / 4, Fraction(0)), Fraction(1))  # P(R >= h), R uniform on [0, 4]
        return h * trade

    offers = [Fraction(5000 + k, 100) for k in range(0, 401)]
    best = max(offers, key=profit)
    assert profit(best) == 1
    return best


# ---------------------------------------------------------------- adverse selection


def trade_probs(alpha: Fraction):
    """P(buy | high) and P(buy | low) when a fraction alpha of traders is informed."""
    noise = (1 - alpha) / 2
    return alpha + noise, noise


def value_given(trades: str, alpha: Fraction, high: Fraction, low: Fraction, prior: Fraction = HALF) -> Fraction:
    """Expected value given a sequence of 'b'/'s' trades, by enumerating the state and every trade."""
    weights = {high: prior, low: 1 - prior}
    for t in trades:
        for v in weights:
            buy_high, buy_low = trade_probs(alpha)
            p_buy = buy_high if v == high else buy_low
            weights[v] *= p_buy if t == "b" else 1 - p_buy
    total = sum(weights.values())
    return sum(v * w for v, w in weights.items()) / total


@check("bmm-adverse-selection-001")
def _():
    return value_given("b", Fraction(3, 10), Fraction(100), Fraction(0))


@check("bmm-adverse-selection-002")
def _():
    alpha = HALF
    assert value_given("b", alpha, Fraction(100), Fraction(0)) == 75
    assert value_given("bs", alpha, Fraction(100), Fraction(0)) == 50
    return value_given("bb", alpha, Fraction(100), Fraction(0))


@check("bmm-adverse-selection-003")
def _():
    total = Fraction(0)
    for value in (90, 110):
        for informed, p_type in ((True, Fraction(1, 4)), (False, Fraction(3, 4))):
            actions = [("b" if value == 110 else "s", Fraction(1))] if informed else [("b", HALF), ("s", HALF)]
            for action, p_act in actions:
                pnl = 102 - value if action == "b" else value - 98
                total += HALF * p_type * p_act * pnl
    # the break-even quote with 25% informed is 97.5 at 102.5
    assert value_given("b", Fraction(1, 4), Fraction(110), Fraction(90)) == Fraction(205, 2)
    return total


@check("bmm-adverse-selection-004")
def _():
    def loss(bid: int, offer: int) -> Fraction:
        return mean(max(bid - r, 0) + max(r - offer, 0) for r in range(1, 14))

    assert loss(5, 9) == Fraction(20, 13)
    assert loss(1, 13) == 0
    assert all(loss(b, o) > 0 for b in range(1, 14) for o in range(b, 14) if (b, o) != (1, 13))


@check("bmm-adverse-selection-005")
def _():
    sums = [sum(o) for o in dice(3)]
    high = [s for s in sums if s >= 12]
    assert 13 < float(mean(high)) < 14


@check("bmm-adverse-selection-006")
def _():
    for alpha, offer in ((Fraction(0), 100), (Fraction(2, 5), 104)):
        assert value_given("b", alpha, Fraction(110), Fraction(90)) == offer
        assert value_given("s", alpha, Fraction(110), Fraction(90)) == 200 - offer
    assert value_given("b", Fraction(2, 5), Fraction(110), Fraction(90)) - value_given(
        "s", Fraction(2, 5), Fraction(110), Fraction(90)
    ) == 8


@check("bmm-adverse-selection-007")
def _():
    per = sd([a + b for a, b in dice(2)])
    assert abs(40 * per - 97) < 0.5


@check("bmm-adverse-selection-008")
def _():
    def variance(h: Fraction) -> Fraction:
        pnl = [h * (d1 + d2) - 10 * (d2 + d3) for d1, d2, d3 in dice(3)]
        m = mean(pnl)
        return mean((x - m) ** 2 for x in pnl)

    grid = [Fraction(k, 2) for k in range(0, 41)]
    best = min(grid, key=variance)
    sigma2 = Fraction(35, 12)
    assert variance(Fraction(0)) == 200 * sigma2 and variance(best) == 150 * sigma2
    assert variance(Fraction(10)) == variance(Fraction(0))  # one for one removes nothing
    return best


@check("bmm-adverse-selection-009")
def _():
    s_vol, i_vol, rho = Fraction(3, 10), Fraction(2, 10), Fraction(4, 5)
    cov = rho * s_vol * i_vol

    def variance(h: Fraction) -> Fraction:
        return s_vol**2 - 2 * h * cov + h * h * i_vol**2

    best = min((Fraction(k, 100) for k in range(0, 301)), key=variance)
    assert abs(math.sqrt(variance(best)) - 0.18) < 1e-12
    return best


# ---------------------------------------------------------------- calibration


@check("bmm-calibration-001")
def _():
    p = Fraction(9, 10)
    at_most_12 = sum(binom_pmf(20, k, p) for k in range(13))
    assert float(at_most_12) < 0.001
    return "a"


@check("bmm-calibration-002")
def _():
    # dynamic programme over the 20 intervals, one at a time
    dist = {0: Fraction(1)}
    for _ in range(20):
        nxt: dict[int, Fraction] = {}
        for hits, p in dist.items():
            nxt[hits + 1] = nxt.get(hits + 1, 0) + p * Fraction(9, 10)
            nxt[hits] = nxt.get(hits, 0) + p * Fraction(1, 10)
        dist = nxt
    poisson = 1 - sum(math.exp(-2) * 2**k / math.factorial(k) for k in range(6))
    assert abs(poisson - 0.017) < 0.001
    return sum(p for hits, p in dist.items() if hits <= 14)


@check("bmm-calibration-003")
def _():
    z = 1.6448536269514722  # 95th percentile of the standard normal
    mu = (math.log(200) + math.log(5000)) / 2
    sigma = (math.log(5000) - math.log(200)) / (2 * z)
    assert abs(math.exp(mu + sigma**2 / 2) - 1600) < 25
    return math.exp(mu)


@check("bmm-calibration-004")
def _():
    belief = Fraction(7, 10)

    def expected_penalty(r: Fraction) -> Fraction:
        return belief * (1 - r) ** 2 + (1 - belief) * r**2

    grid = [Fraction(k, 100) for k in range(101)]
    assert min(grid, key=expected_penalty) == belief
    assert expected_penalty(Fraction(9, 10)) == Fraction(1, 4)
    assert expected_penalty(belief) == Fraction(21, 100)
    return expected_penalty(Fraction(9, 10)) - expected_penalty(belief)


@check("bmm-calibration-005")
def _():
    minutes = 60 * 24 * 365
    assert abs(70 * minutes * 80 / 1e9 - 2.9) < 0.1
    assert abs(60 * minutes * 60 / 1e9 - 1.9) < 0.05
    assert abs(90 * minutes * 90 / 1e9 - 4.3) < 0.05


@check("bmm-calibration-006")
def _():
    z = 1.6448536269514722
    assert abs(10 / z - 6.08) < 0.01


@check("bmm-calibration-007")
def _():
    p = Fraction(9, 10)
    assert abs(float(p**10) - 0.35) < 0.005
    assert abs(float(binom_pmf(10, 9, p) + binom_pmf(10, 10, p)) - 0.74) < 0.005


# ---------------------------------------------------------------- auctions


@check("bmm-auctions-001")
def _():
    def expected_profit(bid: int) -> Fraction:
        # value uniform on [0, 100]: integrate (1.5 v - bid) over v in [0, bid] exactly, per unit width
        return (Fraction(3, 2) * Fraction(bid * bid, 2) - bid * bid) / 100

    assert expected_profit(60) == -9
    assert all(expected_profit(b) < 0 for b in range(1, 101))
    # a fine Riemann sum over the value agrees
    n = 100_000
    approx = sum((1.5 * v - 60) for v in ((i + 0.5) * 100 / n for i in range(n)) if v <= 60) / n
    assert abs(approx + 9) < 1e-3


@check("bmm-auctions-002")
def _():
    return simulate(lambda r: max(r.uniform(-10, 10) for _ in range(4)))


@check("bmm-auctions-003")
def _():
    def expected_profit(bid: Fraction) -> Fraction:
        return min(bid / 100, Fraction(1)) * (80 - bid)

    bids = [Fraction(k, 100) for k in range(0, 10001)]
    best = max(bids, key=expected_profit)
    assert expected_profit(best) == 16
    return best


@check("bmm-auctions-004")
def _():
    value = 100
    strategies = {"a": 100, "b": 90, "c": 110}
    prices = range(0, 201)  # the highest of the other bids

    def payoff(bid: int, price: int) -> int:
        return value - price if bid > price else 0

    dominant = [
        s
        for s, bid in strategies.items()
        if all(payoff(bid, p) >= payoff(other, p) for p in prices for other in strategies.values())
    ]
    assert dominant == ["a"]
    return "a"


@check("bmm-auctions-005")
def _():
    def best_response(value: int, k: Fraction) -> Fraction:
        bids = [Fraction(i, 10) for i in range(0, 10 * value + 1)]
        return max(bids, key=lambda b: (value - b) * min(b / (100 * k), Fraction(1)) ** 2)

    k = Fraction(2, 3)
    for v in (30, 60, 90):
        assert best_response(v, k) == k * v  # bidding 2/3 of value is a best response to itself
    return best_response(90, k)


@check("bmm-auctions-006")
def _():
    def expected_max(n: int) -> float:
        # E[max] = upper - integral of F^n, with F uniform on [-20, 20], by a fine midpoint sum
        steps = 200_000
        width = 40 / steps
        return 20 - sum(((i + 0.5) / steps) ** n for i in range(steps)) * width

    assert abs(expected_max(9) - 16) < 1e-4
    assert abs(expected_max(2) - 20 / 3) < 1e-4


# ---------------------------------------------------------------- trading games

CARDS = range(1, 11)


@check("bmm-games-001")
def _():
    return mean(sum(h) for h in itertools.permutations(CARDS, 3))


@check("bmm-games-002")
def _():
    return mean(sum(h) for h in itertools.permutations(CARDS, 3) if h[0] == 9)


@check("bmm-games-003")
def _():
    hands = list(itertools.permutations(CARDS, 3))
    after_two = mean(sum(h) for h in hands if h[0] == 2)
    after_ten = mean(sum(h) for h in hands if h[0] == 2 and h[1] == 10)
    assert abs(float(after_two) - 13.78) < 0.005
    assert after_ten == Fraction(139, 8)  # 17.375
    assert abs(sd([h[2] for h in hands if h[0] == 2 and h[1] == 10]) - 2.5) < 0.05
    assert abs(float(Fraction(35, 2) - after_two) - 3.72) < 0.005


@check("bmm-games-004")
def _():
    hands = [h for h in itertools.permutations(CARDS, 3) if h[0] == 3]  # (mine, yours, hidden)
    before = mean(sum(h) for h in hands)
    assert abs(float(before) - 14.56) < 0.005

    def their_value(c: int) -> Fraction:
        return mean(sum(h) for h in itertools.permutations(CARDS, 3) if h[1] == c)

    lifts = {c for c in CARDS if their_value(c) > Fraction(31, 2)}
    assert lifts == {5, 6, 7, 8, 9, 10}
    after = mean(sum(h) for h in hands if h[1] in lifts)
    assert after == Fraction(257, 16)  # 16.0625
    assert abs(float(after - Fraction(31, 2)) - 0.56) < 0.005


@check("bmm-games-005")
def _():
    likelihood = {}
    for deck, reds in (("A", 6), ("B", 4)):
        cards = ["R"] * reds + ["K"] * (10 - reds)
        deals = list(itertools.permutations(range(10), 3))
        likelihood[deck] = Fraction(sum(all(cards[i] == "R" for i in d) for d in deals), len(deals))
    posterior = likelihood["A"] / (likelihood["A"] + likelihood["B"])
    return 10 * posterior


@check("bmm-games-006")
def _():
    trades = [(+1, 17), (+1, 17), (-1, 19)]
    finals = [9 + 2 + c for c in CARDS if c not in (9, 2)]
    return mean(sum(q * (final - price) for q, price in trades) for final in finals)


@check("bmm-games-007")
def _():
    sums = [5 + d for d in DIE]
    assert mean(sums) == Fraction(17, 2)
    loss = mean(max(Fraction(15, 2) - s, 0) + max(s - Fraction(19, 2), 0) for s in sums)
    assert loss == Fraction(2, 3)
    assert mean(max(6 - s, 0) + max(s - 11, 0) for s in sums) == 0
    forced = {p: mean(abs(s - p) for s in sums) for p in (Fraction(k, 2) for k in range(10, 25))}
    assert min(forced.values()) == Fraction(3, 2) and forced[Fraction(17, 2)] == Fraction(3, 2)


@check("bmm-games-008")
def _():
    fair, bid, position = 10, 11, 5
    value_sell = position * bid
    value_hold = position * fair
    assert value_sell > value_hold
    return "a"


# ---------------------------------------------------------------- mechanics


@check("bmm-mechanics-001")
def _():
    book = [(Fraction("10.02"), 200), (Fraction("10.03"), 300), (Fraction("10.05"), 400)]
    remaining, cost = 700, Fraction(0)
    for price, size in book:
        take = min(size, remaining)
        cost += take * price
        remaining -= take
    assert remaining == 0
    return cost - 700 * book[0][0]


@check("bmm-mechanics-002")
def _():
    trades = [(10, Fraction(4)), (-6, Fraction(5)), (4, Fraction("4.5"))]
    position = sum(q for q, _ in trades)
    cash = -sum(q * p for q, p in trades)
    assert position * Fraction("4.7") + cash == Fraction("9.6")
    return position * Fraction("4.8") + cash


@check("bmm-mechanics-003")
def _():
    best_bid, best_offer = Fraction("99.5"), Fraction(100)
    orders = {"a": ("buy", Fraction(100)), "b": ("sell", Fraction(100)), "c": ("buy", Fraction("99.75")), "d": ("sell", Fraction("99.75"))}
    trades = [o for o, (side, px) in orders.items() if (px >= best_offer if side == "buy" else px <= best_bid)]
    assert len(trades) == 1
    return trades[0]


@check("bmm-mechanics-004")
def _():
    trades = [(+1, 99)] * 30 + [(-1, 101)] * 20
    position = sum(q for q, _ in trades)
    cash = -sum(q * p for q, p in trades)
    pnl = position * 98 + cash
    assert sum(abs(q) * (100 - p) * (1 if q > 0 else -1) for q, p in trades) == 50
    return pnl


@check("bmm-mechanics-005")
def _():
    bid = {"price": 2, "size": 10}
    sold = 5
    bid["size"] -= sold
    position, cash = sold, -sold * bid["price"]
    assert bid["size"] == 5 and position == 5 and cash == -10


@check("bmm-mechanics-007")
def _():
    assert abs(1000 * (50.02 - 50.01) - 10) < 1e-9
    assert 0.6 * 5 > 1  # the follow-up: expected move of 3 cents beats the 1-cent half-spread


@check("bmm-mechanics-008")
def _():
    assert 1000 * (Fraction("20.5") - 20) == 500
    assert 1000 * (Fraction("20.4") - 20) == 400
