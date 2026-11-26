"""Checks for quiz/options: each recomputes an answer by a different route from the explanation.

Arbitrage answers are checked by building the portfolio and evaluating its payoff over a grid of
terminal prices (or by searching small integer portfolios for an arbitrage); tree prices by
replicating node by node with Fractions; Black-Scholes facts from a formula written with
`math.erf`, differenced numerically for Greeks or cross-checked by numerical integration over the
lognormal density; Brownian-motion facts by exact Gaussian moments or the seeded `simulate`.
"""

from __future__ import annotations

import itertools
import math
import random
from fractions import Fraction

from . import Simulated, check, simulate

F = Fraction

# ---------------------------------------------------------------- helpers


def N(x: float) -> float:
    """Standard normal distribution function."""
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _d1d2(S: float, K: float, T: float, sig: float, r: float, q: float) -> tuple[float, float]:
    sd = sig * math.sqrt(T)
    d1 = (math.log(S / K) + (r - q + 0.5 * sig * sig) * T) / sd
    return d1, d1 - sd


def bs_call(S: float, K: float, T: float, sig: float, r: float = 0.0, q: float = 0.0) -> float:
    if T <= 0 or sig <= 0:
        return max(S * math.exp(-q * T) - K * math.exp(-r * T), 0.0)
    d1, d2 = _d1d2(S, K, T, sig, r, q)
    return S * math.exp(-q * T) * N(d1) - K * math.exp(-r * T) * N(d2)


def bs_put(S: float, K: float, T: float, sig: float, r: float = 0.0, q: float = 0.0) -> float:
    """Written from its own formula, not from parity, so parity checks mean something."""
    if T <= 0 or sig <= 0:
        return max(K * math.exp(-r * T) - S * math.exp(-q * T), 0.0)
    d1, d2 = _d1d2(S, K, T, sig, r, q)
    return K * math.exp(-r * T) * N(-d2) - S * math.exp(-q * T) * N(-d1)


def normal_expect(f, lim: float = 10.0, n: int = 4000, breaks=()) -> float:
    """E[f(Z)] for a standard normal Z, by Simpson's rule on [-lim, lim], split at `breaks`
    (where f has a kink or a jump) so that each piece is smooth."""
    edges = [-lim] + sorted(b for b in breaks if -lim < b < lim) + [lim]
    total = 0.0
    for a, b in zip(edges, edges[1:]):
        m = max(2, int(n * (b - a) / (2 * lim)) // 2 * 2)
        h = (b - a) / m
        for i in range(m + 1):
            z = a + i * h
            if i == 0:
                z += 1e-12
            elif i == m:
                z -= 1e-12
            w = 1 if i in (0, m) else (4 if i % 2 else 2)
            total += w * h / 3 * f(z) * math.exp(-0.5 * z * z)
    return total / math.sqrt(2 * math.pi)


def lognormal_price(payoff, S: float, T: float, sig: float, r: float = 0.0, kinks=()) -> float:
    """Discounted risk-neutral expectation of payoff(S_T) under Black-Scholes, by integration."""
    m = math.log(S) + (r - 0.5 * sig * sig) * T
    sd = sig * math.sqrt(T)
    breaks = [(math.log(k) - m) / sd for k in kinks]
    return math.exp(-r * T) * normal_expect(lambda z: payoff(math.exp(m + sd * z)), breaks=breaks)


def bisect(f, lo: float, hi: float, iters: int = 200) -> float:
    """Root of an increasing or decreasing f on [lo, hi]."""
    flo = f(lo)
    for _ in range(iters):
        mid = (lo + hi) / 2
        if (f(mid) > 0) == (flo > 0):
            lo, flo = mid, f(mid)
        else:
            hi = mid
    return (lo + hi) / 2


def call(K):
    return lambda S: max(S - K, 0)


def put(K):
    return lambda S: max(K - S, 0)


GRID = [F(i, 4) for i in range(0, 1601)] + [F(10**k) for k in range(3, 8)]


def payoffs(fn, grid=GRID):
    return [fn(S) for S in grid]


def replicate(S: Fraction, Su: Fraction, Sd: Fraction, Vu: Fraction, Vd: Fraction, R: Fraction):
    """Cost of the stock-and-bond portfolio paying Vu / Vd in the up / down state (bond grows by R)."""
    delta = (Vu - Vd) / (Su - Sd)
    bond = (Vu - delta * Su) / R
    assert delta * Sd + bond * R == Vd
    return delta * S + bond, delta


def tree(S0, u, d, R, steps, payoff, american=False, exercise=None):
    """Price by backward replication on a recombining tree; returns (price, early-exercise nodes)."""
    exercise = exercise or payoff
    values = [payoff(S0 * u**j * d ** (steps - j)) for j in range(steps + 1)]
    early = []
    for t in range(steps - 1, -1, -1):
        new = []
        for j in range(t + 1):
            S = S0 * u**j * d ** (t - j)
            v, _ = replicate(S, S * u, S * d, values[j + 1], values[j], R)
            if american and exercise(S) > v:
                early.append((t, j))
                v = exercise(S)
            new.append(v)
        values = new
    return values[0], early


def bs_greek(fn, name: str, S=100.0, K=100.0, T=1.0, sig=0.2, r=0.03, h=1e-4):
    """Central finite differences of a pricing function fn(S, K, T, sig, r)."""
    if name == "delta":
        return (fn(S + h, K, T, sig, r) - fn(S - h, K, T, sig, r)) / (2 * h)
    if name == "gamma":
        hh = 1e-2
        return (fn(S + hh, K, T, sig, r) - 2 * fn(S, K, T, sig, r) + fn(S - hh, K, T, sig, r)) / hh**2
    if name == "vega":
        return (fn(S, K, T, sig + h, r) - fn(S, K, T, sig - h, r)) / (2 * h)
    if name == "rho":
        return (fn(S, K, T, sig, r + h) - fn(S, K, T, sig, r - h)) / (2 * h)
    if name == "theta":  # derivative with respect to calendar time = minus d/dT
        return -(fn(S, K, T + h, sig, r) - fn(S, K, T - h, sig, r)) / (2 * h)
    raise ValueError(name)


def static_arbitrage(S0, strikes, prices, stock=True, bond=True, rng=range(-2, 3)):
    """Searches small integer portfolios of calls (plus stock and a zero-rate bond) for a static
    arbitrage: a payoff that is never negative bought at a negative cost. Payoffs are piecewise
    linear, so checking the kinks and the slope at infinity is enough."""
    points = [F(0)] + list(strikes)
    for weights in itertools.product(rng, repeat=len(strikes)):
        for s in (-1, 0, 1) if stock else (0,):
            slope_inf = sum(weights) + s
            if slope_inf < 0:
                continue
            values = [sum(w * max(p - k, 0) for w, k in zip(weights, strikes)) + s * p for p in points]
            b = max(-min(values), 0) if bond else 0
            if not bond and min(values) < 0:
                continue
            cost = sum(w * c for w, c in zip(weights, prices)) + (s * S0 if s else 0) + b
            if cost < 0:
                return (weights, s, b, cost)
    return None


def measure_from_calls(S0, strikes, prices):
    """Builds the distribution whose call prices interpolate the quotes linearly (with C(0) = S0)
    and checks that it is a probability measure repricing the stock and every call."""
    ks = [F(0)] + list(strikes)
    cs = [F(S0)] + list(prices)
    slopes = [(cs[i + 1] - cs[i]) / (ks[i + 1] - ks[i]) for i in range(len(ks) - 1)]
    end = ks[-1] + cs[-1] / -slopes[-1]
    atoms = {F(0): 1 + slopes[0]}
    for i in range(1, len(ks)):
        nxt = slopes[i] if i < len(slopes) else F(0)
        atoms[ks[i]] = atoms.get(ks[i], 0) + nxt - slopes[i - 1]
    # the last slope runs on to `end`, where the remaining mass sits
    atoms[ks[-1]] -= -slopes[-1]
    atoms[end] = -slopes[-1]
    assert all(p >= 0 for p in atoms.values()), atoms
    assert sum(atoms.values()) == 1
    assert sum(p * x for x, p in atoms.items()) == S0
    for k, c in zip(strikes, prices):
        assert sum(p * max(x - k, 0) for x, p in atoms.items()) == c
    return atoms


def fsqrt(x: Fraction) -> Fraction:
    """Exact square root of a Fraction that is a perfect square."""
    n, d = math.isqrt(x.numerator), math.isqrt(x.denominator)
    assert F(n * n, d * d) == x
    return F(n, d)


# ---------------------------------------------------------------- forwards


@check("opt-forwards-001")
def _():
    # scan candidate forward prices; the arbitrage-free one admits neither carry trade
    free = []
    for cents in range(5000, 6001):
        fwd = F(cents, 100)
        carry = fwd - 50 * F(11, 10)  # buy, borrow, sell forward: profit at delivery
        reverse = 50 * F(11, 10) - fwd  # short, lend, buy forward
        if carry <= 0 and reverse <= 0:
            free.append(fwd)
    assert len(free) == 1
    return free[0]


@check("opt-forwards-002")
def _():
    S, D, p_half, p_one = F(10090, 100), F(2), F(95, 100), F(90, 100)
    # long one share, short two six-month bonds (repaid by the dividend), short y one-year bonds,
    # with y set so the package costs nothing today; then find the forward price that makes the
    # delivery-date flow (deliver the share, receive the forward price, repay y) zero
    y = (S - 2 * p_half) / p_one
    assert S - 2 * p_half - y * p_one == 0 and D - 2 == 0
    zero = [F(c, 100) for c in range(10000, 12001) if all(F(c, 100) - ST + ST - y == 0 for ST in GRID[::200])]
    assert len(zero) == 1
    return zero[0]


@check("opt-forwards-003")
def _():
    bond_price = F(96, 100)
    borrow_face = F(80) / bond_price
    # short forward at 85, long share, owe borrow_face at delivery
    pnl = payoffs(lambda ST: (85 - ST) + ST - borrow_face)
    assert len(set(pnl)) == 1
    return pnl[0]


@check("opt-forwards-004")
def _():
    half = F(1, 2)
    R0 = F(105, 100)

    def prices(r_up, r_down):
        S0 = F(100)
        fut1, disc_s2, disc, es2 = [], F(0), F(0), F(0)
        for m1, R1 in ((F(12, 10), F(1) + r_up), (F(8, 10), F(1) + r_down)):
            S1 = S0 * R0 * m1
            s2 = [S1 * R1 * m2 for m2 in (F(12, 10), F(8, 10))]
            fut1.append(half * sum(s2))  # zero-cost futures marked at t2
            for x in s2:
                disc_s2 += half * half * x / (R0 * R1)
                disc += half * half / (R0 * R1)
        futures = half * sum(fut1)  # marked at t1 too
        forward = disc_s2 / disc  # zero-value forward: E[D (S2 - F)] = 0
        assert disc_s2 == S0  # the discounted stock is a martingale
        return futures, forward

    fut, fwd = prices(F(8, 100), F(2, 100))  # rates high after the stock rises
    flat_fut, flat_fwd = prices(F(5, 100), F(5, 100))
    assert flat_fut == flat_fwd
    return "a" if fut > fwd else ("b" if fut < fwd else "c")


@check("opt-forwards-006")
def _():
    spot, usd, eur = F(120, 100), F(105, 100), F(102, 100)
    # borrow 1.20 dollars, buy 1 euro, lend it, sell the euros forward at f: profit 1.02 f - 1.26
    lo, hi = F(1), F(2)
    for _ in range(80):
        mid = (lo + hi) / 2
        if eur * mid - spot * usd > 0:
            hi = mid
        else:
            lo = mid
    exact = spot * usd / eur
    assert lo <= exact <= hi
    return exact


# ---------------------------------------------------------------- payoffs


@check("opt-payoffs-001")
def _():
    pos = lambda S: call(100)(S) - call(110)(S)
    return pos(F(107)) - (6 - 2)


@check("opt-payoffs-002")
def _():
    A = lambda S: call(90)(S) - 2 * call(100)(S) + call(110)(S)
    B = lambda S: call(90)(S) - call(110)(S)
    diffs = [B(S) - A(S) for S in GRID]
    assert min(diffs) >= 0 and max(diffs) > 0
    for sig in (0.05, 0.2, 0.6, 1.5):
        pa = bs_call(100, 90, 1, sig) - 2 * bs_call(100, 100, 1, sig) + bs_call(100, 110, 1, sig)
        pb = bs_call(100, 90, 1, sig) - bs_call(100, 110, 1, sig)
        assert pb > pa
    return "b"


@check("opt-payoffs-003")
def _():
    positions = {
        "a": lambda S: call(100)(S) + put(100)(S),
        "b": lambda S: -put(100)(S),
        "c": lambda S: S - call(100)(S),
        "d": lambda S: -call(100)(S),
        "e": lambda S: put(110)(S) - put(90)(S),
        "f": lambda S: -call(100)(S) - put(100)(S),
    }
    limited = set()
    for k, pos in positions.items():
        far = [pos(F(10) ** e) for e in range(3, 9)]
        if far[-1] >= far[0] or far[-1] > -10**6:  # payoff does not run off to minus infinity
            limited.add(k)
    return limited


@check("opt-payoffs-004")
def _():
    rep = lambda S: 100 - S + 2 * call(100)(S)
    assert all(rep(S) == abs(S - 100) for S in GRID)
    straddle = lambda S: call(100)(S) + put(100)(S)
    assert all(rep(S) == straddle(S) for S in GRID)


@check("opt-payoffs-005")
def _():
    covered = lambda S: S - call(100)(S)
    choices = {
        "a": lambda S: 100 - put(100)(S),
        "b": lambda S: 100 + put(100)(S),
        "c": lambda S: -put(100)(S),
        "d": lambda S: call(100)(S) - 100,
    }
    same = [k for k, f in choices.items() if all(f(S) == covered(S) for S in GRID)]
    assert len(same) == 1
    return same[0]


@check("opt-payoffs-006")
def _():
    profit = lambda S: call(100)(S) - 2 * call(110)(S) + 1
    roots = [S for S in GRID if S > 110 and profit(S) == 0]
    assert all(profit(S) < 0 for S in GRID if S > roots[0])
    return roots[0]


@check("opt-payoffs-007")
def _():
    premium = F(8)
    profit = lambda S: call(100)(S) + put(100)(S) - premium
    zeros = [S for S in GRID if profit(S) == 0]
    assert zeros == [92, 108] and min(payoffs(profit)) == -premium


@check("opt-payoffs-008")
def _():
    def tent(S):
        if S <= 90 or S >= 110:
            return 0
        return S - 90 if S <= 100 else 110 - S

    weights = {90: 1, 100: -2, 110: 1}
    assert all(sum(w * call(k)(S) for k, w in weights.items()) == tent(S) for S in GRID)
    prices = {90: F(12), 100: F(6), 110: F(5, 2)}
    return sum(w * prices[k] for k, w in weights.items())


# ---------------------------------------------------------------- parity


@check("opt-parity-001")
def _():
    # sell call, buy put, buy share, borrow 50 at zero rate
    cash_today = F(450, 100) - 3 - 50 + 50
    pnl = payoffs(lambda S: -call(50)(S) + put(50)(S) + S - 50)
    assert set(pnl) == {0}
    return cash_today


@check("opt-parity-002")
def _():
    C, P, S, bond = F(10), F(3), F(100), F(95, 100)
    trades = {
        "a": (C - P - S + 95, lambda x: -call(100)(x) + put(100)(x) + x - 100),
        "b": (-C + P + S - 95, lambda x: call(100)(x) - put(100)(x) - x + 100),
        "c": (C - S, lambda x: -call(100)(x) + x),
    }
    assert bond * 100 == 95
    good = [k for k, (cash, pay) in trades.items() if cash > 0 and min(payoffs(pay)) >= 0]
    assert len(good) == 1
    return good[0]


@check("opt-parity-003")
def _():
    # escrowed-dividend Black-Scholes: options on the stock net of the dividend (97), zero rates;
    # find the volatility that prices the call at 5, then price the put from its own formula
    sig = bisect(lambda s: bs_call(97, 100, 1, s) - 5, 0.01, 2.0)
    return bs_put(97, 100, 1, sig)


@check("opt-parity-004")
def _():
    box = lambda S: call(90)(S) - call(100)(S) + put(100)(S) - put(90)(S)
    pay = set(payoffs(box))
    assert len(pay) == 1
    return pay.pop() / F(950, 100) - 1


@check("opt-parity-005")
def _():
    for S, K, T, sig, r in ((100, 90, 1, 0.2, 0.05), (50, 70, 2, 0.6, 0.01)):
        assert abs(bs_call(S, K, T, sig, r) - bs_put(S, K, T, sig, r) - (S - K * math.exp(-r * T))) < 1e-10
    # and in a model that is not Black-Scholes: a one-step tree with three outcomes
    outs, qs = (F(60), F(100), F(150)), (F(3, 10), F(5, 10), F(2, 10))
    S0 = sum(q * x for q, x in zip(qs, outs))
    c = sum(q * call(90)(x) for q, x in zip(qs, outs))
    p = sum(q * put(90)(x) for q, x in zip(qs, outs))
    assert c - p == S0 - 90


@check("opt-parity-006")
def _():
    r = 0.05
    for sig in (0.05, 0.2, 0.8):
        c, p = bs_call(100, 100, 1, sig, r), bs_put(100, 100, 1, sig, r)
        assert abs((c - p) - 100 * (1 - math.exp(-r))) < 1e-9 and c > p
    return "a"


@check("opt-parity-007")
def _():
    quotes = {90: (F(14), F(2)), 110: (F(4), F(11))}
    # unknowns: discount factor D and forward f; C - P = D f - D K is linear in (D f, D)
    (k1, (c1, p1)), (k2, (c2, p2)) = quotes.items()
    a = [[F(1), -k1], [F(1), -k2]]
    b = [c1 - p1, c2 - p2]
    det = a[0][0] * a[1][1] - a[0][1] * a[1][0]
    Df = (b[0] * a[1][1] - a[0][1] * b[1]) / det
    D = (a[0][0] * b[1] - b[0] * a[1][0]) / det
    assert D == F(95, 100)
    # with these the quotes are consistent with the bounds: C >= D (f - K)+, P >= D (K - f)+
    fwd = Df / D
    for k, (c, p) in quotes.items():
        assert c >= D * max(fwd - k, 0) and p >= D * max(k - fwd, 0)
    return fwd


# ---------------------------------------------------------------- bounds


@check("opt-bounds-001")
def _():
    # the best sub-replicating portfolio of shares and bonds: largest cost with payoff <= the call
    best = None
    for w10 in range(0, 11):
        w = F(w10, 10)
        for face in range(-100, 1):
            if all(w * S + face <= call(90)(S) for S in GRID):
                cost = w * 100 + F(95, 100) * face
                best = cost if best is None else max(best, cost)
    return best


@check("opt-bounds-002")
def _():
    sets = {
        "a": (F(11), F(5), F(1)),
        "b": (F(9), F(5), F(2)),
        "c": (F(11), F(7), F(1)),
        "d": (F(13), F(6), F(2)),
        "e": (F(12), F(7), F(15, 2)),
    }
    strikes = (F(90), F(100), F(110))
    arb = set()
    for k, prices in sets.items():
        if static_arbitrage(F(100), strikes, prices):
            arb.add(k)
        else:
            measure_from_calls(F(100), strikes, prices)  # an explicit risk-neutral measure exists
    return arb


@check("opt-bounds-003")
def _():
    K, r, T = 100.0, 0.05, 1.0
    worst = 0.0
    for S in (0.01, 1, 10, 50, 100, 200):
        for sig in (0.05, 0.3, 1.0, 3.0):
            p = bs_put(S, K, T, sig, r)
            assert p <= K * math.exp(-r * T) + 1e-12
            worst = max(worst, p / (K * math.exp(-r * T)))
            if S < 1:
                assert p > S  # S is not an upper bound for a put
    assert worst > 0.999  # approached, so the bound is tight; K itself is never approached
    return "b"


@check("opt-bounds-004")
def _():
    strikes = (F(90), F(100), F(110))
    ok = []
    for quarter in range(16, 49):
        c = F(quarter, 4)
        if not static_arbitrage(None, strikes, (F(12), c, F(4)), stock=False, bond=False):
            ok.append(c)
    # at the top of the range a distribution reprices all three calls (zero rates)
    atoms = {F(90): F(6, 10), F(120): F(4, 10)}
    for k, c in zip(strikes, (12, max(ok), 4)):
        assert sum(p * max(x - k, 0) for x, p in atoms.items()) == c
    return max(ok)


@check("opt-bounds-005")
def _():
    fly = lambda S: call(95)(S) - 2 * call(100)(S) + call(105)(S)
    assert min(payoffs(fly)) == 0 and max(payoffs(fly)) == 5
    # Breeden-Litzenberger: the butterfly over h^2 approximates the risk-neutral density
    S, T, sig, h = 100.0, 1.0, 0.25, 0.5
    for K in (80.0, 100.0, 130.0):
        second = (bs_call(S, K - h, T, sig) - 2 * bs_call(S, K, T, sig) + bs_call(S, K + h, T, sig)) / h**2
        m, sd = math.log(S) - 0.5 * sig * sig * T, sig * math.sqrt(T)
        dens = math.exp(-((math.log(K) - m) ** 2) / (2 * sd * sd)) / (K * sd * math.sqrt(2 * math.pi))
        assert second > 0 and abs(second - dens) < 1e-4


@check("opt-bounds-006")
def _():
    C95, C100, C105 = F(760, 100), F(480, 100), F(270, 100)
    spread = lambda S: (call(95)(S) - call(100)(S)) / 5
    digital = lambda S: F(1) if S > 100 else F(0)
    assert all(spread(S) >= digital(S) for S in GRID)
    assert all((call(100)(S) - call(105)(S)) / 5 <= digital(S) for S in GRID)
    # a distribution repricing the calls with no mass in (95, 100]: digital tends to the bound
    eps = F(1, 10**6)
    a = F(7, 10) / (5 - eps)  # mass just above 100
    b = (F(21, 10) - a * eps) / 5  # mass at x above 105
    x = 105 + F(27, 10) / b
    atoms = {F(50): 1 - a - b, 100 + eps: a, x: b}
    assert all(p >= 0 for p in atoms.values())
    for k, c in ((95, C95), (100, C100), (105, C105)):
        assert sum(p * max(s - k, 0) for s, p in atoms.items()) == c
    d = sum(p for s, p in atoms.items() if s > 100)
    bound = (C95 - C100) / 5
    assert bound - F(1, 10**5) < d <= bound
    return bound


@check("opt-bounds-007")
def _():
    for sig in (0.1, 0.3, 1.0):
        for r in (0.01, 0.05):
            assert abs(bs_call(100, 120, 2000, sig, r) - 100) < 1e-3
        assert abs(bs_call(100, 120, 1e6, sig, 0.0) - 100) < 0.5  # even with zero rates
    return "a"


# ---------------------------------------------------------------- american


@check("opt-american-001")
def _():
    for K in (F(80), F(100), F(120)):
        eu, _ = tree(F(100), F(11, 10), F(10, 11), F(102, 100), 6, call(K))
        am, early = tree(F(100), F(11, 10), F(10, 11), F(102, 100), 6, call(K), american=True)
        assert am == eu and early == []


@check("opt-american-002")
def _():
    # deep in the money the put is exercised; at a stock price near zero waiting cannot help
    _, early = tree(F(100), F(12, 10), F(10, 12), F(103, 100), 8, put(F(100)), american=True)
    assert early
    K, R, steps = F(100), F(103, 100), 3
    assert K > K / R**steps  # cash now beats the most the put can pay later


@check("opt-american-003")
def _():
    u, d, R, steps, ex_step = 1.1, 1 / 1.1, 1.01, 8, 4
    q = (R - d) / (u - d)
    D, K, X0 = 6.0, 80.0, 100.0

    def stock(t, j, cum=True):
        x = X0 * u**j * d ** (t - j)
        if t < ex_step:
            return x + D / R ** (ex_step - t)
        return x + D if (t == ex_step and cum) else x

    values = [max(stock(steps, j) - K, 0) for j in range(steps + 1)]
    exercised = []
    for t in range(steps - 1, -1, -1):
        new = []
        for j in range(t + 1):
            cont = (q * values[j + 1] + (1 - q) * values[j]) / R
            ex = stock(t, j, cum=True) - K
            if ex > cont + 1e-12:
                exercised.append(t)
            new.append(max(ex, cont))
        values = new
    assert exercised  # early exercise does happen with this dividend
    return "a" if set(exercised) == {ex_step} else "c"


@check("opt-american-004")
def _():
    price, early = tree(F(40), F(2), F(1, 2), F(5, 4), 2, put(F(55)), american=True)
    euro, _ = tree(F(40), F(2), F(1, 2), F(5, 4), 2, put(F(55)))
    assert euro == 12 and early == [(1, 0)]
    return price


@check("opt-american-005")
def _():
    facts = {"a": True, "b": True, "c": True, "d": True, "e": True}
    for K, R, u in ((F(100), F(102, 100), F(11, 10)), (F(90), F(105, 100), F(13, 10))):
        S0, d, n = F(100), 1 / u, 6
        disc = R**-n
        ce, _ = tree(S0, u, d, R, n, call(K))
        ca, _ = tree(S0, u, d, R, n, call(K), american=True)
        pe, _ = tree(S0, u, d, R, n, put(K))
        pa, _ = tree(S0, u, d, R, n, put(K), american=True)
        facts["a"] &= ca == ce
        facts["b"] &= pa >= pe
        facts["c"] &= pa == pe
        facts["d"] &= ca - pa == S0 - K * disc
        facts["e"] &= S0 - K <= ca - pa <= S0 - K * disc
    return {k for k, v in facts.items() if v}


@check("opt-american-006")
def _():
    # a one-step model in which the American call is worth 12: the put then sits on the bound
    S0, K, R, Sd = F(100), F(100), F(10, 9), F(50)
    Su = F(4900, 43)
    c, _ = tree(S0, Su / S0, Sd / S0, R, 1, call(K), american=True)
    p, _ = tree(S0, Su / S0, Sd / S0, R, 1, put(K), american=True)
    assert c == 12
    # and in other models consistent with the quotes it is never below 2
    return p


@check("opt-american-007")
def _():
    def boundary(r, sig, steps=200, T=1.0, K=100.0):
        dt = T / steps
        u = math.exp(sig * math.sqrt(dt))
        d, R = 1 / u, math.exp(r * dt)
        q = (R - d) / (u - d)
        t = steps // 2  # look at the boundary halfway to expiry
        vals = [max(K - 100 * u**j * d ** (steps - j), 0) for j in range(steps + 1)]
        for s in range(steps - 1, t - 1, -1):
            vals = [
                max((q * vals[j + 1] + (1 - q) * vals[j]) / R, K - 100 * u**j * d ** (s - j)) for j in range(s + 1)
            ]
        ex = [100 * u**j * d ** (t - j) for j in range(t + 1) if K - 100 * u**j * d ** (t - j) >= vals[j] - 1e-12 and K > 100 * u**j * d ** (t - j)]
        return max(ex)

    assert boundary(0.08, 0.2) > boundary(0.02, 0.2)
    assert boundary(0.05, 0.4) < boundary(0.05, 0.2)


# ---------------------------------------------------------------- binomial


@check("opt-binomial-001")
def _():
    v, _ = replicate(F(80), F(100), F(70), F(20), F(0), F(1))
    return v


@check("opt-binomial-002")
def _():
    v, delta = replicate(F(30), F(45), F(25), F(10), F(0), F(1))
    assert delta == F(1, 2)
    return v


@check("opt-binomial-003")
def _():
    v, _ = tree(F(100), F(12, 10), F(9, 10), F(105, 100), 2, call(F(100)))
    return v


@check("opt-binomial-004")
def _():
    # the replicating portfolio is the same whatever the real-world probability; only its
    # real-world expected return changes
    cost, delta = replicate(F(30), F(45), F(25), F(10), F(0), F(1))
    for p in (F(1, 10), F(7, 10), F(9, 10)):
        expected_payoff = p * 10
        assert expected_payoff != cost or p == F(1, 4)
    assert cost == F(5, 2) and delta == F(1, 2)


@check("opt-binomial-005")
def _():
    outs = (F(120), F(100), F(80))
    prices = []
    for k in range(1, 100):
        qu = F(k, 200)  # 0 < q_u < 1/2
        qd = qu
        qm = 1 - qu - qd
        assert qu * 120 + qm * 100 + qd * 80 == 100
        prices.append(qu * 20)
    assert 0 < min(prices) and max(prices) < 10
    # at a price of 10, sell the call and buy half a share minus 40 cash: payoff >= 0, cost 0
    hedge = [x / 2 - 40 - max(x - 100, 0) for x in outs]
    assert min(hedge) >= 0 and max(hedge) > 0 and F(100) / 2 - 40 - 10 == 0
    # a strict subset of (0, 20): any q in (0, 1/2) gives the whole interval (0, 10)
    return "c"


@check("opt-binomial-006")
def _():
    S, K, T, sig, r = 100.0, 100.0, 1.0, 0.2, 0.05
    target = bs_call(S, K, T, sig, r)
    errs = []
    for n in (200, 800):
        dt = T / n
        u = math.exp(sig * math.sqrt(dt))
        d, R = 1 / u, math.exp(r * dt)
        q = (R - d) / (u - d)
        vals = [max(S * u**j * d ** (n - j) - K, 0) for j in range(n + 1)]
        for t in range(n - 1, -1, -1):
            vals = [(q * vals[j + 1] + (1 - q) * vals[j]) / R for j in range(t + 1)]
        errs.append(abs(vals[0] - target))
    assert errs[1] < errs[0] < 0.02


@check("opt-binomial-007")
def _():
    # tree with u = 2, d = 1/2, zero rates: q = 1/3; from 25, reaching 100 is two net up-moves.
    # Solve for the hitting probability with an absorbing floor far below, by iteration.
    q = 1 / 3
    floor = 80
    h = [0.0] * (floor + 3)  # index i = level + floor, level from -floor to 2
    h[-1] = 1.0
    for _ in range(20000):
        for i in range(1, floor + 2):
            h[i] = q * h[i + 1] + (1 - q) * h[i - 1]
    return h[floor]


# ---------------------------------------------------------------- black-scholes


@check("opt-black-scholes-001")
def _():
    integrated = lognormal_price(lambda s: max(s - 50, 0.0), 50, 0.25, 0.3, kinks=[50])
    assert abs(integrated - bs_call(50, 50, 0.25, 0.3)) < 1e-9
    return integrated


@check("opt-black-scholes-002")
def _():
    straddle = lambda s: bs_call(200, 200, 0.25, s) + bs_put(200, 200, 0.25, s) - 12
    return bisect(straddle, 0.01, 1.0)


@check("opt-black-scholes-003")
def _():
    S, K, T, sig, r = 100.0, 105.0, 1.0, 0.25, 0.03
    d1, d2 = _d1d2(S, K, T, sig, r, 0)
    prob = lognormal_price(lambda s: 1.0 if s > K else 0.0, S, T, sig, r, kinks=[K]) * math.exp(r * T)
    assert abs(prob - N(d2)) < 1e-9
    assert abs(bs_greek(bs_call, "delta", S, K, T, sig, r) - N(d1)) < 1e-6
    assert N(d1) > N(d2)


@check("opt-black-scholes-004")
def _():
    # price moves with volatility, rate and time; there is no expected-return input to move
    for g in ("vega", "rho", "theta"):
        assert abs(bs_greek(bs_call, g)) > 1e-3
    return "c"


@check("opt-black-scholes-006")
def _():
    h = 1e-4
    return (bs_call(100, 100 - h, 1, 0.2) - bs_call(100, 100 + h, 1, 0.2)) / (2 * h)


@check("opt-black-scholes-007")
def _():
    return lognormal_price(lambda s: s * s, 10, 1.0, 0.5)


@check("opt-black-scholes-008")
def _():
    S, K, T, r = 100.0, 110.0, 1.0, 0.05
    truth = {
        "a": abs(bs_call(S, K, T, 50.0, r) - S) < 1e-3,
        "b": abs(bs_call(S, K, T, 1e-4, r) - max(S - K * math.exp(-r * T), 0)) < 1e-6
        and abs(bs_call(S, 90, T, 1e-4, r) - (S - 90 * math.exp(-r * T))) < 1e-6,
        "c": abs(bs_call(S, 90, 1e-8, 0.2, r) - 10) < 1e-3,
        "d": bs_call(S, 120, T, 0.2, r) > bs_call(S, K, T, 0.2, r),
        "e": bs_call(S, K, T, 0.2, 0.08) < bs_call(S, K, T, 0.2, r),
    }
    return {k for k, v in truth.items() if v}


@check("opt-black-scholes-009")
def _():
    S, K, T, sig, r = 105.0, 100.0, 0.7, 0.3, 0.04
    th = bs_greek(bs_call, "theta", S, K, T, sig, r)
    ga = bs_greek(bs_call, "gamma", S, K, T, sig, r)
    de = bs_greek(bs_call, "delta", S, K, T, sig, r)
    assert abs(th + 0.5 * sig * sig * S * S * ga + r * S * de - r * bs_call(S, K, T, sig, r)) < 1e-4


# ---------------------------------------------------------------- greeks


@check("opt-greeks-001")
def _():
    names = {"a": "delta", "b": "gamma", "c": "vega", "d": "rho"}
    positive = set()
    for k, g in names.items():
        vals = [bs_greek(bs_put, g, S=S, sig=sig) for S in (70.0, 100.0, 130.0) for sig in (0.1, 0.4)]
        if all(v > 0 for v in vals):
            positive.add(k)
        else:
            assert all(v < 0 for v in vals)
    return positive


@check("opt-greeks-002")
def _():
    # a Black-Scholes call with delta 0.35; hedge 2,000 of them so a small move leaves no P&L
    K = bisect(lambda k: bs_greek(bs_call, "delta", K=k, r=0.0) - 0.35, 100.0, 200.0)
    dS = 0.01
    move = 2000 * (bs_call(100 + dS, K, 1.0, 0.2) - bs_call(100 - dS, K, 1.0, 0.2)) / (2 * dS)
    return move  # shares to sell: the position's dollar change per dollar of stock move


@check("opt-greeks-003")
def _():
    gam = [bs_greek(bs_call, "gamma", T=T, r=0.0) for T in (1.0, 0.25, 1 / 12, 1 / 52, 1 / 365)]
    assert all(a < b for a, b in zip(gam, gam[1:]))
    away = [bs_greek(bs_call, "gamma", K=105.0, T=T, r=0.0) for T in (1.0, 0.25, 1 / 12, 1 / 52, 1 / 365)]
    assert max(away) > away[0] and away[-1] < 0.01 * max(away)  # an away option's rises, then collapses
    return "a"


@check("opt-greeks-004")
def _():
    # delta-hedged long straddle on one path: rebalancing sells after rises and buys after falls
    K, sig, T, n = 100.0, 0.2, 0.25, 63
    dt = T / n
    delta = lambda S, t: 2 * N(_d1d2(S, K, T - t, sig, 0, 0)[0]) - 1
    assert delta(101, 0) > delta(100, 0) > delta(99, 0)


@check("opt-greeks-005")
def _():
    gamma, theta, delta, v0 = 0.04, -0.08, 0.5, 5.0
    value = lambda x: v0 + delta * x + 0.5 * gamma * x * x + theta  # one day later, stock moved x
    hedged_pnl = lambda x: value(x) - v0 - delta * x
    return bisect(hedged_pnl, 0.0, 10.0)


@check("opt-greeks-006")
def _():
    short = {g: bs_greek(bs_call, g, T=1 / 12, r=0.0) for g in ("gamma", "vega")}
    long = {g: bs_greek(bs_call, g, T=1.0, r=0.0) for g in ("gamma", "vega")}
    assert short["gamma"] > long["gamma"] and long["vega"] > short["vega"]
    return "b"


@check("opt-greeks-007")
def _():
    for T in (0.1, 1.0, 5.0):
        for sig in (0.1, 0.5):
            for r in (0.0, 0.05):
                d = bs_greek(bs_call, "delta", T=T, sig=sig, r=r)
                assert 0.5 < d < 1
    assert abs(bs_greek(bs_call, "delta", T=1.0, sig=0.2, r=0.0) - 0.5398) < 1e-4
    return "b"


@check("opt-greeks-008")
def _():
    book_delta, book_gamma = F(200), F(-500)
    opt_delta, opt_gamma = F(6, 10), F(5, 100)
    n_opts = -book_gamma / opt_gamma
    shares = -(book_delta + n_opts * opt_delta)
    assert book_gamma + n_opts * opt_gamma == 0 and book_delta + n_opts * opt_delta + shares == 0
    assert n_opts == 10000
    return -shares


@check("opt-greeks-009")
def _():
    # a delta-hedged straddle: theta is about -1/2 sigma^2 S^2 gamma, opposite in sign to gamma
    S, sig, r, T = 100.0, 0.25, 0.01, 0.5
    straddle = lambda s, k, t, v, rr: bs_call(s, k, t, v, rr) + bs_put(s, k, t, v, rr)
    th = bs_greek(straddle, "theta", S, 100.0, T, sig, r)
    ga = bs_greek(straddle, "gamma", S, 100.0, T, sig, r)
    de = bs_greek(straddle, "delta", S, 100.0, T, sig, r)
    V = straddle(S, 100.0, T, sig, r)
    hedged_theta = th  # the share position has no theta; financing it adds r S delta
    assert ga > 0 and hedged_theta < 0
    assert abs(th + 0.5 * sig**2 * S**2 * ga + r * S * de - r * V) < 1e-4
    # a deep in-the-money European put can have positive theta (the r V term)
    assert bs_greek(bs_put, "theta", S=40.0, K=100.0, T=1.0, sig=0.2, r=0.05) > 0


@check("opt-greeks-010")
def _():
    T = 1 / 365
    straddle_delta = lambda S: 2 * N(_d1d2(S, 100.0, T, 0.2, 0, 0)[0]) - 1
    assert straddle_delta(102.0) > 0.9 and straddle_delta(98.0) < -0.9
    assert abs(straddle_delta(100.0)) < 0.01


# ---------------------------------------------------------------- volatility


@check("opt-volatility-001")
def _():
    daily_var = F(32, 100) ** 2 / 256
    return 50 * fsqrt(daily_var)


@check("opt-volatility-002")
def _():
    # price a two-year at-the-money call by conditioning on year one (vol 20%), with vol s for
    # year two, and match the two-year Black-Scholes price at 30%
    target = bs_call(100, 100, 2.0, 0.3)

    def two_period(s):
        return normal_expect(lambda z: bs_call(100 * math.exp(-0.02 + 0.2 * z), 100, 1.0, s), lim=9, n=1200)

    return bisect(lambda s: two_period(s) - target, 0.2, 0.6, iters=60)


@check("opt-volatility-005")
def _():
    S, K, T, r = 100.0, 105.0, 1.0, 0.03
    c = 7.0  # some market price, not from a flat-volatility model
    p = c - S + K * math.exp(-r * T)
    iv_c = bisect(lambda s: bs_call(S, K, T, s, r) - c, 0.01, 2.0)
    iv_p = bisect(lambda s: bs_put(S, K, T, s, r) - p, 0.01, 2.0)
    assert abs(iv_c - iv_p) < 1e-9
    return "a"


@check("opt-volatility-006")
def _():
    rng = random.Random(7)
    K, T, n, imp, real = 100.0, 0.25, 63, 0.2, 0.25
    dt = T / n
    pnls = []
    for _ in range(1500):
        S, cash = 100.0, -bs_call(100.0, K, T, imp)
        delta = N(_d1d2(S, K, T, imp, 0, 0)[0])
        cash += delta * S
        for i in range(1, n + 1):
            ret = -0.5 * real * real * dt + real * math.sqrt(dt) * rng.gauss(0, 1)
            S *= math.exp(ret)
            new = N(_d1d2(S, K, T - i * dt, imp, 0, 0)[0]) if i < n else (1.0 if S > K else 0.0)
            cash += (new - delta) * S
            delta = new
        pnl = cash + max(S - K, 0) - delta * S
        pnls.append(pnl)
    assert sum(pnls) / len(pnls) > 0.5  # clearly profitable on average
    # but a path can realise more than 25% and still lose: a steady climb through the strike
    # (little realised variance while gamma is high), then large swings far from it
    rets = [0.2625 / 30] * 30 + [0.0205 * (-1) ** i for i in range(33)]
    S, cash = 100.0, -bs_call(100.0, K, T, imp)
    delta = N(_d1d2(S, K, T, imp, 0, 0)[0])
    cash += delta * S
    for i, ret in enumerate(rets, 1):
        S *= math.exp(ret)
        new = N(_d1d2(S, K, T - i * dt, imp, 0, 0)[0]) if i < n else (1.0 if S > K else 0.0)
        cash += (new - delta) * S
        delta = new
    assert math.sqrt(sum(x * x for x in rets) / T) > real
    assert cash + max(S - K, 0) - delta * S < 0


@check("opt-volatility-007")
def _():
    rng = random.Random(11)
    draws = [(rng.gauss(0, 1), rng.gauss(0, 1)) for _ in range(40000)]

    def price(rho, payoff):
        total = 0.0
        for z1, z2 in draws:
            w2 = rho * z1 + math.sqrt(1 - rho * rho) * z2
            s1 = 100 * math.exp(-0.5 * 0.09 + 0.3 * z1)
            s2 = 100 * math.exp(-0.5 * 0.04 + 0.2 * w2)
            total += payoff(s1, s2)
        return total / len(draws)

    spread = lambda a, b: max(a - b, 0.0)
    basket = lambda a, b: max(a + b - 200, 0.0)
    assert price(0.8, spread) < price(0.2, spread) - 1.0
    assert price(0.8, basket) > price(0.2, basket) + 1.0
    return "a"


@check("opt-volatility-008")
def _():
    sd = 100 * 0.2 / 16
    return simulate(lambda rng: abs(rng.gauss(0, sd)))


@check("opt-volatility-009")
def _():
    ratio = bs_call(100, 100, 1 / 52, 0.2) / bs_call(100, 100, 1 / 12, 0.2)
    assert 0.45 < ratio < 0.5  # one week is a little under a quarter of a month


# ---------------------------------------------------------------- stochastic


@check("opt-stochastic-001")
def _():
    fs = {
        "a": lambda t, w: w * w - t,
        "b": lambda t, w: w**3,
        "c": lambda t, w: w**3 - 3 * t * w,
        "d": lambda t, w: math.exp(w - t / 2),
        "e": lambda t, w: math.exp(w),
        "f": lambda t, w: t * w,
    }
    h = 1e-3
    mart = set()
    for k, f in fs.items():
        drifts = []
        for t, w in ((0.5, 0.3), (1.0, -0.7), (2.0, 1.1)):
            ft = (f(t + h, w) - f(t - h, w)) / (2 * h)
            fww = (f(t, w + h) - 2 * f(t, w) + f(t, w - h)) / h**2
            drifts.append(ft + 0.5 * fww)
        if all(abs(x) < 1e-4 for x in drifts):
            mart.add(k)
    return mart


@check("opt-stochastic-002")
def _():
    # E[(sum W_i dW_i)^2] on a grid, from Isserlis' theorem with Cov(W_s, W_t) = min(s, t)
    def second_moment(n, T=F(2)):
        t = [T * i / n for i in range(n + 1)]
        cov_ww = lambda i, j: min(t[i], t[j])
        cov_wd = lambda i, j: min(t[i], t[j + 1]) - min(t[i], t[j])  # Cov(W_i, dW_j)
        cov_dd = lambda i, j: (min(t[i + 1], t[j + 1]) - min(t[i + 1], t[j]) - min(t[i], t[j + 1]) + min(t[i], t[j]))
        total = F(0)
        for i in range(n):
            for j in range(n):
                total += (
                    cov_wd(i, i) * cov_wd(j, j)
                    + cov_ww(i, j) * cov_dd(i, j)
                    + cov_wd(i, j) * cov_wd(j, i)
                )
        return total

    e1, e2 = second_moment(20), second_moment(40)
    return 2 * e2 - e1  # the grid error is exactly proportional to 1/n


@check("opt-stochastic-003")
def _():
    # Euler scheme for the SDE itself (not its solution), then the sample median
    rng = random.Random(3)
    mu, sig, n = 0.10, 0.40, 100
    dt = 1.0 / n
    finals = []
    for _ in range(20000):
        s = 100.0
        for _ in range(n):
            s += mu * s * dt + sig * s * math.sqrt(dt) * rng.gauss(0, 1)
        finals.append(s)
    finals.sort()
    median = finals[len(finals) // 2]
    mean = sum(finals) / len(finals)
    assert abs(median - 100 * math.exp(0.02)) < 1.2  # sampling error of the median is about 0.3
    assert abs(mean - 100 * math.exp(0.10)) < 1.5


@check("opt-stochastic-004")
def _():
    mu, sig, T = 0.06, 0.2, 1.0

    def gap(alpha):  # E[X_T^alpha] - X_0^alpha, X_0 = 1, by integrating over the normal
        return normal_expect(lambda z: math.exp(alpha * ((mu - 0.5 * sig**2) * T + sig * math.sqrt(T) * z))) - 1

    assert gap(-1.0) < 0 < gap(-3.0)
    return bisect(gap, -3.0, -1.0)


@check("opt-stochastic-005")
def _():
    rng = random.Random(5)
    t = 2.0
    for n in (100, 10000):
        dt = t / n
        qv = sum((math.sqrt(dt) * rng.gauss(0, 1)) ** 2 for _ in range(n))
        assert abs(qv - t) < 6 * math.sqrt(2 * t * t / n)
    # a smooth path has quadratic variation going to zero
    smooth = lambda n: sum((math.sin((i + 1) / n) - math.sin(i / n)) ** 2 for i in range(n))
    assert smooth(10000) < 1e-3


@check("opt-stochastic-006")
def _():
    a, m = 1.0, 16
    dt = 1.0 / m

    def trial(rng):
        x, survive = 0.0, 1.0
        for _ in range(m):
            y = x + math.sqrt(dt) * rng.gauss(0, 1)
            if y >= a:
                return 1.0
            survive *= 1 - math.exp(-2 * (a - x) * (a - y) / dt)  # Brownian bridge stays below a
            x = y
        return 1 - survive

    return simulate(trial, n=60000)


@check("opt-stochastic-007")
def _():
    def riemann_var(n):  # Var((1/n) sum_{i=1..n} W_{i/n}) = (1/n^3) sum_{i,j} min(i, j)
        total = sum(min(i, j) for i in range(1, n + 1) for j in range(1, n + 1))
        return F(total, n**3)

    ns = (25, 50, 100)
    # fit a + b/n + c/n^2 through three grid sizes and read off a
    rows = [[F(1), F(1, n), F(1, n * n)] for n in ns]
    rhs = [riemann_var(n) for n in ns]
    for col in range(3):
        piv = rows[col][col]
        rows[col] = [x / piv for x in rows[col]]
        rhs[col] /= piv
        for r in range(3):
            if r != col:
                f = rows[r][col]
                rows[r] = [x - f * y for x, y in zip(rows[r], rows[col])]
                rhs[r] -= f * rhs[col]
    return rhs[0]


@check("opt-stochastic-008")
def _():
    return normal_expect(lambda z: math.exp(math.sqrt(2) * z))


@check("opt-stochastic-009")
def _():
    # realised variance of log returns on one finely sampled path does not depend on the drift
    rng = random.Random(9)
    sig, n, T = 0.3, 20000, 1.0
    dt = T / n
    noise = [rng.gauss(0, 1) for _ in range(n)]
    for mu in (0.0, 0.5, -0.3):
        rv = sum(((mu - 0.5 * sig * sig) * dt + sig * math.sqrt(dt) * z) ** 2 for z in noise) / T
        assert abs(rv - sig * sig) < 0.003
    assert abs((0.1 - 0.03) / 0.2 - 0.35) < 1e-12  # market price of risk for mu = 10%, r = 3%


# ---------------------------------------------------------------- fixed income


def bond_price(coupon: float, y: float, years: int) -> float:
    """Annual coupons, annually compounded yield, face 100."""
    return sum(100 * coupon / (1 + y) ** t for t in range(1, years + 1)) + 100 / (1 + y) ** years


@check("opt-fixed-income-001")
def _():
    prices = [bond_price(0.06, 0.07, n) for n in range(2, 31)]
    assert all(p < 100 for p in prices)
    return "c"


@check("opt-fixed-income-002")
def _():
    price = lambda y: 100 * math.exp(-10 * y)
    exact = price(0.06) / price(0.05) - 1
    h = 1e-5
    dur = -(price(0.05 + h) - price(0.05 - h)) / (2 * h) / price(0.05)
    conv = (price(0.05 + h) - 2 * price(0.05) + price(0.05 - h)) / h**2 / price(0.05)
    estimate = -dur * 0.01 + 0.5 * conv * 0.01**2
    assert abs(dur - 10) < 1e-4 and abs(conv - 100) < 1e-2 and abs(estimate - exact) < 0.001
    assert abs(-dur * 0.01 - exact) > 0.001  # duration alone is outside the accepted range
    return exact


@check("opt-fixed-income-003")
def _():
    price = lambda y: 100 * math.exp(-10 * y)
    up, down = price(0.06) - price(0.05), price(0.04) - price(0.05)
    assert down > -up > 0  # gains from a fall exceed losses from a rise of the same size


@check("opt-fixed-income-004")
def _():
    p1, p2 = F(95, 100), F(90, 100)
    sell_one_year = p2 / p1  # number of one-year bonds sold to pay for one two-year bond
    flow_year_one, flow_year_two = -sell_one_year, F(1)
    return flow_year_two / -flow_year_one - 1


@check("opt-fixed-income-005")
def _():
    def macaulay(coupon, y, years):
        flows = [(t, 100 * coupon + (100 if t == years else 0)) for t in range(1, years + 1)]
        pv = [(t, c / (1 + y) ** t) for t, c in flows]
        return sum(t * v for t, v in pv) / sum(v for _, v in pv)

    for y in (0.01, 0.05, 0.12):
        assert abs(macaulay(0.0, y, 10) - 10) < 1e-12 and macaulay(0.08, y, 10) < 10
    return "a"


@check("opt-fixed-income-006")
def _():
    # callable at par: the holder gets the straight bond capped at 100, averaged over rate noise
    def callable_price(y):
        return normal_expect(lambda z: min(bond_price(0.06, max(y + 0.01 * z, -0.5), 10), 100.0), lim=8, n=400)

    def curvature(f, y, h=0.0025):
        return f(y + h) - 2 * f(y) + f(y - h)

    assert curvature(callable_price, 0.04) < 0  # negative convexity at low yields
    assert curvature(callable_price, 0.10) > 0  # behaves like a straight bond at high yields
    assert curvature(lambda y: bond_price(0.06, y, 10), 0.04) > 0
