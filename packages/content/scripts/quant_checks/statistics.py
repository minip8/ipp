"""Checks for quiz/statistics: each recomputes an answer, or the facts a question relies on, by
a different route from its explanation.

Estimators are simulated and their bias or spread measured; regressions are fitted by solving
the normal equations on simulated or constructed data; posteriors are integrated on a grid;
exact answers are found by brute-force search or enumeration with Fractions. Simulations are
seeded and sized so the whole module runs in well under two minutes.
"""

from __future__ import annotations

import itertools
import math
import random
from fractions import Fraction
from statistics import NormalDist

from . import Simulated, check, simulate

STD = NormalDist()

# ---------------------------------------------------------------- helpers


def mean(xs):
    return sum(xs) / len(xs)


def var(xs, ddof=1):
    m = mean(xs)
    return sum((x - m) ** 2 for x in xs) / (len(xs) - ddof)


def corr(xs, ys):
    mx, my = mean(xs), mean(ys)
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    sxx = sum((x - mx) ** 2 for x in xs)
    syy = sum((y - my) ** 2 for y in ys)
    return sxy / math.sqrt(sxx * syy)


def ranks(xs):
    order = sorted(range(len(xs)), key=lambda i: xs[i])
    r = [0.0] * len(xs)
    for k, i in enumerate(order):
        r[i] = float(k)
    return r


def solve(a, b):
    """Gauss-Jordan elimination for a square system a x = b (floats or Fractions)."""
    n = len(a)
    m = [list(row) + [rhs] for row, rhs in zip(a, b)]
    for col in range(n):
        piv = max(range(col, n), key=lambda r: abs(m[r][col]))
        if m[piv][col] == 0:
            raise ZeroDivisionError("singular system")
        m[col], m[piv] = m[piv], m[col]
        p = m[col][col]
        m[col] = [x / p for x in m[col]]
        for r in range(n):
            if r != col and m[r][col] != 0:
                f = m[r][col]
                m[r] = [x - f * y for x, y in zip(m[r], m[col])]
    return [m[r][n] for r in range(n)]


def det(a):
    """Determinant by elimination (floats or Fractions)."""
    n = len(a)
    m = [list(row) for row in a]
    d = 1
    for col in range(n):
        piv = max(range(col, n), key=lambda r: abs(m[r][col]))
        if m[piv][col] == 0:
            return 0
        if piv != col:
            m[col], m[piv] = m[piv], m[col]
            d = -d
        d *= m[col][col]
        for r in range(col + 1, n):
            f = m[r][col] / m[col][col]
            m[r] = [x - f * y for x, y in zip(m[r], m[col])]
    return d


def ols(columns, y, ridge=0):
    """OLS (or ridge) coefficients by the normal equations. `columns` are the regressors,
    including a column of ones if an intercept is wanted."""
    p = len(columns)
    xtx = [[sum(a * b for a, b in zip(columns[i], columns[j])) + (ridge if i == j else 0) for j in range(p)] for i in range(p)]
    xty = [sum(a * b for a, b in zip(columns[i], y)) for i in range(p)]
    return solve(xtx, xty)


def ols_fit(columns, y):
    """Coefficients, their usual standard errors, residuals and R^2 (intercept assumed included)."""
    n, p = len(y), len(columns)
    beta = ols(columns, y)
    fitted = [sum(b * c[i] for b, c in zip(beta, columns)) for i in range(n)]
    resid = [yi - fi for yi, fi in zip(y, fitted)]
    rss = sum(r * r for r in resid)
    my = mean(y)
    tss = sum((yi - my) ** 2 for yi in y)
    s2 = rss / (n - p)
    xtx = [[sum(a * b for a, b in zip(columns[i], columns[j])) for j in range(p)] for i in range(p)]
    se = []
    for j in range(p):
        e = [1.0 if k == j else 0.0 for k in range(p)]
        se.append(math.sqrt(s2 * solve(xtx, e)[j]))
    return beta, se, resid, 1 - rss / tss


def slope(x, y):
    """Simple-regression slope of y on x, with intercept."""
    mx, my = mean(x), mean(y)
    return sum((a - mx) * (b - my) for a, b in zip(x, y)) / sum((a - mx) ** 2 for a in x)


def batch_estimate(values) -> Simulated:
    """Mean and standard error of a list of independent replicate values."""
    n = len(values)
    m = sum(values) / n
    v = sum((x - m) ** 2 for x in values) / (n - 1)
    return Simulated(m, math.sqrt(v / n), n)


def sqrt_of(sim: Simulated) -> Simulated:
    """The square root of a simulated mean, with its delta-method standard error."""
    root = math.sqrt(sim.mean)
    return Simulated(root, sim.stderr / (2 * root), sim.trials)


def binom_pmf(n, k, p):
    return math.comb(n, k) * p**k * (1 - p) ** (n - k)


def bisect(f, lo, hi, iters=200):
    """A root of f in [lo, hi], where f changes sign."""
    flo = f(lo)
    for _ in range(iters):
        mid = (lo + hi) / 2
        fm = f(mid)
        if (fm > 0) == (flo > 0):
            lo, flo = mid, fm
        else:
            hi = mid
    return (lo + hi) / 2


def argmax_unimodal(f, lo, hi, iters=300):
    """Golden-section search for the maximum of a unimodal f on [lo, hi]."""
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


def simpson(f, a, b, n=2000):
    """Composite Simpson's rule with n (even) intervals."""
    h = (b - a) / n
    s = f(a) + f(b)
    for i in range(1, n):
        s += (4 if i % 2 else 2) * f(a + i * h)
    return s * h / 3


def random_walk(rng, n):
    p, out = 0.0, []
    for _ in range(n):
        p += rng.gauss(0, 1)
        out.append(p)
    return out


def orthonormal_columns(vectors):
    """Gram-Schmidt: an orthonormal basis of the span of `vectors` (lists of floats)."""
    basis = []
    for v in vectors:
        w = list(v)
        for q in basis:
            d = sum(a * b for a, b in zip(w, q))
            w = [a - d * b for a, b in zip(w, q)]
        norm = math.sqrt(sum(a * a for a in w))
        basis.append([a / norm for a in w])
    return basis


# ---------------------------------------------------------------- sampling


@check("stat-sampling-001")
def _():
    # daily returns of +-1% (a deliberately non-normal distribution with sd 1%); the standard
    # error is the square root of E[(mean - 0)^2], measured over many 400-day samples
    def trial(rng):
        heads = rng.binomialvariate(400, 0.5)
        m = 0.01 * (2 * heads - 400) / 400
        return m * m

    return sqrt_of(simulate(trial, n=100_000, seed=1))


@check("stat-sampling-002")
def _():
    rng = random.Random(2)
    out = {}
    for n in (50, 5000):
        xs = [rng.gauss(0.0005, 0.01) for _ in range(n)]
        s = math.sqrt(var(xs))
        se = s / math.sqrt(n)
        out[n] = {"a": s, "b": se, "c": 2 * 1.96 * se, "d": 2 * 1.96 * math.sqrt(s * s + se * se), "e": s / math.sqrt(2 * n)}
    # spread of the sample sd itself, by replication
    sds = {n: [math.sqrt(var([rng.gauss(0, 1) for _ in range(n)])) for _ in range(300)] for n in (20, 500)}
    assert math.sqrt(var(sds[500])) < math.sqrt(var(sds[20])) / 3
    shrinks = {k for k in "abcde" if out[5000][k] < out[50][k] / 3}
    assert 0.008 < out[5000]["a"] < 0.012 and out[5000]["d"] > 0.035
    return shrinks


@check("stat-sampling-003")
def _():
    rng = random.Random(3)
    pnl = [1 if rng.random() < 0.95 else -25 for _ in range(200_000)]
    assert sorted(pnl)[len(pnl) // 2] == 1 and mean(pnl) < -0.25
    assert abs(Fraction(95, 100) * 1 - Fraction(5, 100) * 25 - Fraction(-3, 10)) == 0
    assert abs(0.95**20 - 0.36) < 0.005
    # a 20-day backtest shows a positive mean about 36% of the time
    pos = sum(all(rng.random() < 0.95 for _ in range(20)) for _ in range(20_000)) / 20_000
    assert abs(pos - 0.358) < 0.015


@check("stat-sampling-004")
def _():
    rng = random.Random(4)

    def cauchy():
        return math.tan(math.pi * (rng.random() - 0.5))

    def pareto():
        return (1 - rng.random()) ** (-1 / 1.5)

    converges = set()
    # a: the mean of 2,000 Cauchy draws is as spread out as one draw (|x| > 1 half the time)
    big = sum(abs(mean([cauchy() for _ in range(2000)])) > 1 for _ in range(200)) / 200
    assert 0.38 < big < 0.62
    # b: the median of 2,001 Cauchy draws is within 0.15 of 0 nearly always
    med = [sorted(cauchy() for _ in range(2001))[1000] for _ in range(200)]
    if max(abs(m) for m in med) < 0.2:
        converges.add("b")
    # c and d: Pareto with tail index 1.5 has mean 3; its sample variance grows with n
    m_big = sorted(mean([pareto() for _ in range(100_000)]) for _ in range(5))
    if abs(m_big[2] - 3) < 0.25:
        converges.add("c")
    v_small = sorted(var([pareto() for _ in range(1000)]) for _ in range(41))[20]
    v_big = sorted(var([pareto() for _ in range(30_000)]) for _ in range(41))[20]
    if v_big < 2 * v_small:
        converges.add("d")
    # e: coin flips
    if abs(mean([rng.choice((-1, 1)) for _ in range(100_000)])) < 0.02:
        converges.add("e")
    if abs(mean([cauchy() for _ in range(100_000)])) < 0.02 and big < 0.1:
        converges.add("a")
    return converges


@check("stat-sampling-005")
def _():
    streak = sum(1 for o in itertools.product((0, 1), repeat=5) if all(o))
    return 1000 * Fraction(streak, 2**5)


@check("stat-sampling-006")
def _():
    # funds with zero true alpha; a fund closes once its cumulative return falls below -20%;
    # the surviving funds' average annual return is positive although every fund's mean is 0
    rng = random.Random(6)
    survivors, everyone = [], []
    for _ in range(4000):
        wealth, rets, alive = 1.0, [], True
        for _ in range(10):
            r = rng.gauss(0.0, 0.15)
            rets.append(r)
            wealth *= 1 + r
            if wealth < 0.8:
                alive = False
                break
        everyone.extend(rets)
        if alive:
            survivors.extend(rets)
    assert abs(mean(everyone)) < 0.01 and mean(survivors) > 0.02


@check("stat-sampling-007")
def _():
    # one trade opens each minute; a trade opened at minute s with duration d is open at the
    # snapshots s + 0.5, ..., s + d - 0.5. Pool snapshots in 40 independent batches.
    rng = random.Random(7)
    batches = []
    for _ in range(20):
        durations = [1 if rng.random() < 0.5 else 59 for _ in range(3000)]
        total = count = 0
        # snapshot at minute t sees trades opened in (t - d, t]
        for t in range(100, 3000):
            for s in range(t - 59, t + 1):
                d = durations[s]
                if s + d > t:  # opened at s, still open at t + 0.5
                    total += d
                    count += 1
        batches.append(total / count)
    return batch_estimate(batches)


@check("stat-sampling-008")
def _():
    rng = random.Random(8)
    # skewness of a mean of 25 exponentials (skew 2) is 2/5
    ms = [mean([rng.expovariate(1) for _ in range(25)]) for _ in range(40_000)]
    m, s = mean(ms), math.sqrt(var(ms))
    skew = mean([((x - m) / s) ** 3 for x in ms])
    assert abs(skew - 0.4) < 0.06
    # a fat-tailed (t with 3 df) variable: 5-sd moves are far more common than under the normal
    def t3():
        z = rng.gauss(0, 1)
        chi = sum(rng.gauss(0, 1) ** 2 for _ in range(3))
        return z / math.sqrt(chi / 3) / math.sqrt(3)  # scaled to variance 1

    tail = sum(abs(t3()) > 5 for _ in range(200_000)) / 200_000
    assert tail > 50 * 2 * STD.cdf(-5)


@check("stat-sampling-009")
def _():
    p = Fraction(sum(math.comb(10, k) for k in (9, 10)), 2**10)
    assert p == Fraction(11, 1024)
    # nine small wins and one large loss can lose money
    assert 9 * 1 - 1 * 12 < 0


# ---------------------------------------------------------------- estimation


@check("stat-estimation-001")
def _():
    # exact: every ordered sample of 3 die rolls; the n - 1 divisor is unbiased for 35/12
    total = Fraction(0)
    count = 0
    for s in itertools.product(range(1, 7), repeat=3):
        m = Fraction(sum(s), 3)
        total += sum((x - m) ** 2 for x in s)
        count += 1
    assert total / count / 2 == Fraction(35, 12)
    # normal data, n = 5: E[s] < sigma, and divisor n + 1 has the smallest MSE for sigma^2
    rng = random.Random(11)
    mse = {4: 0.0, 5: 0.0, 6: 0.0}
    s_sum = 0.0
    trials = 60_000
    for _ in range(trials):
        xs = [rng.gauss(0, 1) for _ in range(5)]
        m = sum(xs) / 5
        ss = sum((x - m) ** 2 for x in xs)
        s_sum += math.sqrt(ss / 4)
        for d in mse:
            mse[d] += (ss / d - 1) ** 2
    assert s_sum / trials < 0.96  # E[s] = 0.940 for n = 5
    assert mse[6] < mse[5] < mse[4]


@check("stat-estimation-002")
def _():
    gaps = [2, 3, 5, 10]
    return argmax_unimodal(lambda lam: sum(math.log(lam) - lam * x for x in gaps), 1e-6, 5)


@check("stat-estimation-003")
def _():
    # find a, b with E[a*max + b] = N for every N, by exact enumeration of all 4-subsets
    def e_max(n):
        subsets = list(itertools.combinations(range(1, n + 1), 4))
        return Fraction(sum(max(c) for c in subsets), len(subsets))

    e8, e12 = e_max(8), e_max(12)
    a = Fraction(12 - 8) / (e12 - e8)
    b = 8 - a * e8
    for n in (6, 10, 15):
        assert a * e_max(n) + b == n
    return a * 60 + b


@check("stat-estimation-004")
def _():
    rng = random.Random(14)
    n, theta = 4, 10.0
    sim = simulate(lambda r: max(r.uniform(0, theta) for _ in range(n)), n=100_000, seed=14)
    ratio = sim.mean / theta
    assert abs(ratio - n / (n + 1)) < 0.005
    return "b" if ratio < 0.99 else ("c" if ratio > 1.01 else "a")


@check("stat-estimation-005")
def _():
    data = [1, 2, 9]
    assert 2 * Fraction(sum(data), 3) == 8 < max(data)
    sim = simulate(lambda r: 2 * mean([r.uniform(0, 9.5) for _ in range(3)]), n=100_000, seed=15)
    assert abs(sim.mean - 9.5) < 4 * sim.stderr  # unbiased
    assert Fraction(4, 3) * 9 == 12
    return "b"


@check("stat-estimation-006")
def _():
    w = argmax_unimodal(lambda w: -(w * w * 0.09 + (1 - w) ** 2 * 0.16), 0, 1)
    sd = math.sqrt(w * w * 0.09 + (1 - w) ** 2 * 0.16)
    assert abs(sd - 0.24) < 1e-6
    return w * 10.0 + (1 - w) * 10.4


@check("stat-estimation-007")
def _():
    rng = random.Random(17)
    x = [rng.uniform(-1, 1) for _ in range(60)]
    y = [0.5 + 2 * xi + rng.gauss(0, 0.3) for xi in x]
    b0, b1 = ols([[1.0] * 60, x], y)

    def normal_loglik(c0, c1, s2=0.09):
        return sum(-0.5 * math.log(2 * math.pi * s2) - (yi - c0 - c1 * xi) ** 2 / (2 * s2) for xi, yi in zip(x, y))

    best = normal_loglik(b0, b1)
    for d0, d1 in ((0.01, 0), (-0.01, 0), (0, 0.01), (0, -0.01)):
        assert normal_loglik(b0 + d0, b1 + d1) < best
    # Laplace errors: the MLE of a location is the median (minimises absolute deviations)
    pts = [rng.expovariate(1) for _ in range(101)]
    loc = argmax_unimodal(lambda c: -sum(abs(p - c) for p in pts), 0, 10)
    assert abs(loc - sorted(pts)[50]) < 1e-6
    # ridge is the MAP with a normal prior: the ridge solution maximises loglik + log prior
    lam = 0.09 / 0.25  # sigma^2 / tau^2
    r0, r1 = ols([[1.0] * 60, x], y, ridge=lam)

    def posterior(c0, c1):
        return normal_loglik(c0, c1) - (c0 * c0 + c1 * c1) / (2 * 0.25)

    for d0, d1 in ((0.01, 0), (-0.01, 0), (0, 0.01), (0, -0.01)):
        assert posterior(r0 + d0, r1 + d1) < posterior(r0, r1)


@check("stat-estimation-008")
def _():
    rng = random.Random(18)
    n, trials = 5, 50_000
    mle = 0.0
    for _ in range(trials):
        xs = [rng.gauss(0, 1) for _ in range(n)]
        m = sum(xs) / n
        mle += sum((x - m) ** 2 for x in xs) / n
    assert abs(mle / trials - (n - 1) / n) < 0.01  # biased: b and e false
    # consistency of the exponential-rate MLE, and its small-sample upward bias
    lam = 2.0
    big = [rng.expovariate(lam) for _ in range(200_000)]
    assert abs(len(big) / sum(big) - lam) < 0.02
    small = mean([4 / sum(rng.expovariate(lam) for _ in range(4)) for _ in range(50_000)])
    assert abs(small - lam * 4 / 3) < 0.05
    # asymptotic variance 1/(n I): for a Bernoulli p, I = 1/(p(1-p))
    p, n_big = 0.3, 400
    ests = [rng.binomialvariate(n_big, p) / n_big for _ in range(20_000)]
    assert abs(var(ests) * n_big / (p * (1 - p)) - 1) < 0.05
    return {"a", "c", "d"}


@check("stat-estimation-009")
def _():
    mu, sigma, n = 0.0004, 0.01, 250
    assert abs(mu * mu / sigma**2 - 0.0016) < 1e-12
    assert abs(sigma / math.sqrt(n) - 0.00063) < 0.00001
    rng = random.Random(19)
    err_zero = err_demeaned = 0.0
    for _ in range(4000):
        r = [rng.gauss(mu, sigma) for _ in range(n)]
        zero = sum(x * x for x in r) / n
        err_zero += (zero - sigma**2) ** 2
        err_demeaned += (var(r) - sigma**2) ** 2
    # practically the same mean squared error (within simulation noise of a few per cent)
    assert abs(err_zero / err_demeaned - 1) < 0.05


@check("stat-estimation-010")
def _():
    def loglik(n):
        return math.log(math.comb(50, 7)) + math.log(math.comb(n - 50, 33)) - math.log(math.comb(n, 40))

    best = max(range(83, 5000), key=loglik)
    assert loglik(best) > loglik(best + 1) and loglik(best) > loglik(best - 1)
    return best


@check("stat-estimation-011")
def _():
    lam = 0.7
    series = sum((-1) ** k * math.exp(-lam) * lam**k / math.factorial(k) for k in range(60))
    assert abs(series - math.exp(-2 * lam)) < 1e-12
    # shrinking a noisy mean: mu = 0.05, sigma/sqrt(n) = 0.1; c = 1/2 beats c = 1
    rng = random.Random(21)
    errs = {1.0: 0.0, 0.5: 0.0}
    for _ in range(50_000):
        xbar = rng.gauss(0.05, 0.1)
        for c in errs:
            errs[c] += (c * xbar - 0.05) ** 2
    assert errs[0.5] < errs[1.0] * 0.5


# ---------------------------------------------------------------- confidence intervals and tests


@check("stat-testing-001")
def _():
    # p-values are uniform under the null, and P(null | p < 0.05) is large when real effects are rare
    rng = random.Random(31)
    null_sig = real_sig = 0
    small = 0
    for i in range(100_000):
        real = i % 100 == 0  # 1 signal in 100 is real
        z = rng.gauss(2.5 if real else 0.0, 1)
        p = 2 * (1 - STD.cdf(abs(z)))
        if not real and p < 0.03:
            small += 1
        if p < 0.05:
            if real:
                real_sig += 1
            else:
                null_sig += 1
    assert abs(small / 99_000 - 0.03) < 0.003
    assert null_sig / (null_sig + real_sig) > 0.8
    return "b"


@check("stat-testing-002")
def _():
    rng = random.Random(32)
    n, mu = 10, 1.0
    t975 = 2.2621571627  # t quantile, 9 degrees of freedom
    cover = new_inside = 0
    trials = 40_000
    for _ in range(trials):
        xs = [rng.gauss(mu, 1) for _ in range(n)]
        m, s = mean(xs), math.sqrt(var(xs))
        lo, hi = m - t975 * s / math.sqrt(n), m + t975 * s / math.sqrt(n)
        cover += lo <= mu <= hi
        new_mean = mean([rng.gauss(mu, 1) for _ in range(n)])
        new_inside += lo <= new_mean <= hi
    assert abs(cover / trials - 0.95) < 0.005
    # known-variance version of the "new sample mean" claim: P(|Z| < 1.96/sqrt 2) = 0.834
    assert abs(2 * STD.cdf(1.96 / math.sqrt(2)) - 1 - 0.834) < 0.001
    assert new_inside / trials < 0.9
    return "b"


@check("stat-testing-003")
def _():
    hits = total = 0
    for colours in itertools.product(range(5), repeat=3):
        for guesses in itertools.product(range(5), repeat=3):
            total += 1
            hits += sum(c == g for c, g in zip(colours, guesses)) >= 2
    assert (40 - 20) / math.sqrt(100 * 0.2 * 0.8) == 5
    return Fraction(hits, total)


@check("stat-testing-004")
def _():
    # power of the one-sided z-test computed directly; smallest n reaching 80%
    crit = STD.inv_cdf(0.95)

    def power(n):
        return 1 - STD.cdf(crit - 0.1 * math.sqrt(n))

    n = next(k for k in range(1, 5000) if power(k) >= 0.8)
    # simulated power at that n
    rng = random.Random(34)
    rej = sum(rng.gauss(0.1, 1 / math.sqrt(n)) > crit / math.sqrt(n) for _ in range(40_000)) / 40_000
    assert abs(rej - 0.8) < 0.01
    assert round((crit / 0.1) ** 2) == 271
    return n


@check("stat-testing-005")
def _():
    # sum the binomial probabilities of 1..20 false positives
    p = sum(math.comb(20, k) * Fraction(1, 20) ** k * Fraction(19, 20) ** (20 - k) for k in range(1, 21))
    return float(p)


@check("stat-testing-006")
def _():
    rng = random.Random(36)
    ratios = []
    for _ in range(40):
        false = true = 0
        for _ in range(50):  # 50 batches of 1,000 signals
            false += sum(rng.random() < 0.05 for _ in range(900))
            true += sum(rng.random() < 0.5 for _ in range(100))
        ratios.append(false / (false + true))
    return batch_estimate(ratios)


@check("stat-testing-007")
def _():
    sd = math.sqrt(1000 * 0.05 * 0.95)
    assert abs(sd - 6.9) < 0.05 and 1.3 < (60 - 50) / sd < 1.6
    # expected maximum of 1,000 independent standard normals, by integrating 1 - F^1000
    emax = simpson(lambda x: 1 - STD.cdf(x) ** 1000, 0, 8, 4000) - simpson(lambda x: STD.cdf(x) ** 1000, -8, 0, 4000)
    assert 3.15 < emax < 3.3
    assert 0.05 / 1000 == 0.00005


@check("stat-testing-008")
def _():
    def power(mu=0.2, n=50, sigma=1.0, alpha=0.05, sides=2):
        z = mu * math.sqrt(n) / sigma
        c = STD.inv_cdf(1 - alpha / sides)
        return (1 - STD.cdf(c - z)) + (STD.cdf(-c - z) if sides == 2 else 0)

    base = power()
    changes = {
        "a": power(n=100),
        "b": power(alpha=0.01),
        "c": power(sigma=0.5),
        "d": power(alpha=0.10),
        "e": power(sides=1),
        "f": base,
    }
    return {k for k, v in changes.items() if v > base + 1e-9}


@check("stat-testing-009")
def _():
    rng = random.Random(39)
    trials = 40_000
    false_pos = 0
    for _ in range(trials):
        s = 0.0
        for k in range(1, 21):
            s += rng.gauss(0, 1)
            if abs(s / math.sqrt(k)) > 1.96:
                false_pos += 1
                break
    rate = false_pos / trials
    assert 0.2 < rate < 0.3, rate
    # the constant boundary that gives 5% overall over 20 looks
    def overall(c, rng=random.Random(40), m=20_000):
        hits = 0
        for _ in range(m):
            s = 0.0
            for k in range(1, 21):
                s += rng.gauss(0, 1)
                if abs(s / math.sqrt(k)) > c:
                    hits += 1
                    break
        return hits / m

    assert overall(2.6) > 0.05 > overall(2.8)


@check("stat-testing-010")
def _():
    sd = math.sqrt(900 * 0.5 * 0.5)
    z = (485 - 450) / sd
    # exact binomial two-sided p-value
    tail = sum(binom_pmf(900, k, 0.5) for k in range(485, 901))
    assert 2 * tail < 0.05
    assert abs(z - 2.33) < 0.01 and abs(35 / 30 - 1.17) < 0.01 and abs(35 / 225 - 0.156) < 0.001
    return "a" if abs(z) > 1.96 else "b"


@check("stat-testing-011")
def _():
    return bisect(lambda p: (1 - p) ** 300 - 0.05, 0.0, 0.1)


@check("stat-testing-012")
def _():
    sr = 1.5 / math.sqrt(2)
    se = 1 / math.sqrt(2)
    assert abs(sr - 1.06) < 0.005 and abs(se - 0.71) < 0.005
    assert abs((sr - 1.96 * se) + 0.33) < 0.01 and abs((sr + 1.96 * se) - 2.45) < 0.01
    # a true Sharpe-1 strategy over two years of daily data: t-statistic below 1.96 most of the time
    rng = random.Random(42)
    days, mu, sigma = 504, 1 / math.sqrt(252) * 0.01, 0.01
    below = 0
    for _ in range(2000):
        r = [rng.gauss(mu, sigma) for _ in range(days)]
        t = mean(r) / math.sqrt(var(r) / days)
        below += t < 1.96
    assert below / 2000 > 0.6


# ---------------------------------------------------------------- Bayesian inference


def poly_mul(a, b):
    out = [Fraction(0)] * (len(a) + len(b) - 1)
    for i, x in enumerate(a):
        for j, y in enumerate(b):
            out[i + j] += x * y
    return out


def poly_integral_01(c):
    return sum(Fraction(x) / (k + 1) for k, x in enumerate(c))


def beta_kernel(a, b):
    """Coefficients of p^(a-1) (1-p)^(b-1), integer a, b >= 1."""
    c = [Fraction(0)] * (a - 1) + [Fraction(1)]
    for _ in range(b - 1):
        c = poly_mul(c, [Fraction(1), Fraction(-1)])
    return c


@check("stat-bayesian-001")
def _():
    # prior Beta(2, 2) times the likelihood p^7 (1-p)^3, integrated exactly as polynomials
    post = poly_mul(beta_kernel(2, 2), beta_kernel(8, 4))
    return poly_integral_01(poly_mul(post, [Fraction(0), Fraction(1)])) / poly_integral_01(post)


@check("stat-bayesian-002")
def _():
    def post(s):
        return math.exp(-0.5 * (s / 0.5) ** 2) * math.exp(-0.5 * ((1.5 - s) * 3) ** 2)

    z = simpson(post, -4, 5, 20_000)
    m = simpson(lambda s: s * post(s), -4, 5, 20_000) / z
    sd_one_year = simpson(lambda s: s * math.exp(-0.5 * (s / 0.5) ** 2 - 0.5 * (1.5 - s) ** 2), -5, 6, 20_000)
    sd_one_year /= simpson(lambda s: math.exp(-0.5 * (s / 0.5) ** 2 - 0.5 * (1.5 - s) ** 2), -5, 6, 20_000)
    assert abs(sd_one_year - 0.3) < 1e-6
    return m


@check("stat-bayesian-003")
def _():
    def post(lam):
        return lam * math.exp(-lam) * lam**10 * math.exp(-4 * lam)

    z = simpson(post, 0, 20, 20_000)
    m = simpson(lambda x: x * post(x), 0, 20, 20_000) / z
    mode = argmax_unimodal(post, 0.01, 10)
    assert abs(mode - 2.2) < 1e-6
    options = {"a": 12 / 5, "b": 10 / 4, "c": 11 / 5, "d": 3.0, "e": 2.0}
    return min(options, key=lambda k: abs(options[k] - m))


@check("stat-bayesian-004")
def _():
    def like(p):
        return math.comb(100, 60) * p**60 * (1 - p) ** 40

    a = Fraction(1, 10) * like(Fraction(55, 100))
    b = Fraction(9, 10) * like(Fraction(1, 2))
    post = a / (a + b)
    # 60 wins: two sds above 50, one sd above 55
    assert abs((60 - 50) / 5 - 2) < 1e-12 and abs((60 - 55) / math.sqrt(100 * 0.55 * 0.45) - 1.005) < 0.01
    return float(post)


@check("stat-bayesian-005")
def _():
    rng = random.Random(55)
    xs = [rng.gauss(0.8, 1) for _ in range(30)]
    # a: flat prior -> MAP = MLE = sample mean (grid search on the log posterior)
    mle = argmax_unimodal(lambda m: -sum((x - m) ** 2 for x in xs), -5, 5)
    assert abs(mle - mean(xs)) < 1e-6
    # b: prior N(0, 1/4) and n = 30 unit-variance observations: precision weights 4 and 30
    def post(m):
        return math.exp(-2 * m * m - sum((x - m) ** 2 for x in xs) / 2)

    pm = simpson(lambda m: m * post(m), -3, 4, 8000) / simpson(post, -3, 4, 8000)
    assert abs(pm - 30 * mean(xs) / 34) < 1e-6
    # d: the posterior mean is biased towards zero: E[30/34 * xbar] = (30/34) mu
    sims = [30 / 34 * mean([rng.gauss(0.8, 1) for _ in range(30)]) for _ in range(5000)]
    assert mean(sims) < 0.8 - 0.06
    # f: the binomial (n = 12) and negative-binomial (stop at the 3rd tail) likelihoods of 9 heads
    # and 3 tails have a constant ratio in p, so they give the same posterior
    def binom_lik(p):
        return math.comb(12, 9) * p**9 * (1 - p) ** 3

    def negbin_lik(p):  # 9 heads and 2 tails in any order, then a tail
        return math.comb(11, 2) * p**9 * (1 - p) ** 2 * (1 - p)

    ratios = {binom_lik(Fraction(k, 10)) / negbin_lik(Fraction(k, 10)) for k in range(1, 10)}
    assert len(ratios) == 1
    return {"a", "b", "e"}


@check("stat-bayesian-006")
def _():
    rng = random.Random(56)
    err_raw = err_shrunk = 0.0
    for _ in range(50):
        years = [1 if i % 2 else 10 for i in range(200)]
        true = [rng.gauss(0.3, 0.3) for _ in range(200)]
        est = [s + rng.gauss(0, 1 / math.sqrt(t)) for s, t in zip(true, years)]
        m = mean(est)
        tau2 = max(var(est) - mean([1 / t for t in years]), 1e-6)
        shrunk = [m + tau2 / (tau2 + 1 / t) * (e - m) for e, t in zip(est, years)]
        err_raw += sum((e - s) ** 2 for e, s in zip(est, true))
        err_shrunk += sum((e - s) ** 2 for e, s in zip(shrunk, true))
        # the top-ranked raw estimate overstates its true value
    assert err_shrunk < 0.5 * err_raw
    assert abs((0.5 - 0.4) / 0.5 - 0.2) < 1e-12


@check("stat-bayesian-007")
def _():
    binom_p = Fraction(sum(math.comb(12, k) for k in range(9, 13)), 2**12)
    # negative binomial: at least 9 heads before the 3rd tail = at most 2 tails in the first 11
    negbin_p = Fraction(sum(math.comb(11, k) for k in range(3)), 2**11)
    # cross-check the negative binomial tail by summing P(exactly h heads before the 3rd tail)
    direct = sum(Fraction(math.comb(h + 2, 2), 2 ** (h + 3)) for h in range(9, 400))
    assert abs(float(direct - negbin_p)) < 1e-12
    assert binom_p == Fraction(299, 4096) and negbin_p == Fraction(67, 2048)
    assert binom_p > Fraction(1, 20) > negbin_p
    # Lindley: Bayes factor for H0: mu = 0 against mu ~ N(0, 1) at fixed z = 2 grows like sqrt(n)
    def bf01(n, z=2.0):
        xbar = z / math.sqrt(n)
        l0 = math.exp(-0.5 * n * xbar**2)
        # densities of xbar, both divided by sqrt(n): N(0, 1/n) under H0, N(0, 1 + 1/n) under H1
        v1 = 1 + 1 / n
        l1 = math.exp(-0.5 * xbar**2 / v1) / math.sqrt(v1 * n)
        return l0 / l1

    assert bf01(10_000) > 10 > 1 > bf01(10)


# ---------------------------------------------------------------- linear regression


def centred(v):
    m = mean(v)
    return [x - m for x in v]


@check("stat-regression-001")
def _():
    rng = random.Random(61)
    x = [rng.gauss(0, 1) for _ in range(200)]
    y = [0.5 * xi + rng.gauss(0, 1) for xi in x]
    a, b = ols([[1.0] * 200, x], y)

    def vertical(a_, b_):
        return sum((yi - a_ - b_ * xi) ** 2 for xi, yi in zip(x, y))

    for da, db in ((0.01, 0), (0, 0.01), (0, -0.01), (-0.01, 0)):
        assert vertical(a + da, b + db) > vertical(a, b)
    # the x-on-y line and the perpendicular (first principal component) line are different
    reverse = 1 / slope(y, x)
    cx, cy = centred(x), centred(y)
    sxx, syy, sxy = sum(u * u for u in cx), sum(v * v for v in cy), sum(u * v for u, v in zip(cx, cy))
    tls = (syy - sxx + math.sqrt((syy - sxx) ** 2 + 4 * sxy * sxy)) / (2 * sxy)
    assert b < tls < reverse
    return "a"


@check("stat-regression-002")
def _():
    # an exact data set: x = (1, -1, 1, -1), y = 1.2 x + 1.6 (1, 1, -1, -1)
    x = [Fraction(v) for v in (1, -1, 1, -1)]
    e = [Fraction(16, 10) * v for v in (1, 1, -1, -1)]
    y = [Fraction(12, 10) * a + b for a, b in zip(x, e)]
    vx = sum(a * a for a in x) / 4
    vy = sum(b * b for b in y) / 4 - (sum(y) / 4) ** 2
    cov = sum(a * b for a, b in zip(x, y)) / 4
    assert vy == 4 * vx and cov * cov / (vx * vy) == Fraction(36, 100) and cov > 0
    return ols([[Fraction(1)] * 4, x], y)[1]


@check("stat-regression-003")
def _():
    rng = random.Random(63)
    x = [rng.gauss(0, 1) for _ in range(500)]
    y = [0.7 * a + rng.gauss(0, 1) for a in x]
    b_yx, b_xy, r = slope(x, y), slope(y, x), corr(x, y)
    assert abs(b_yx * b_xy - r * r) < 1e-9
    answer = 0.36 / 0.8
    options = {"a": 1.25, "b": 0.45, "c": 0.8}
    return min(options, key=lambda k: abs(options[k] - answer))


@check("stat-regression-004")
def _():
    rng = random.Random(64)
    n = 40
    x = [rng.gauss(0, 1) for _ in range(n)]
    y = [1 + 0.3 * a + rng.gauss(0, 1) for a in x]
    b1, se1, _, r2_1 = ols_fit([[1.0] * n, x], y)
    b2, se2, _, r2_2 = ols_fit([[1.0] * (2 * n), x + x], y + y)
    assert all(abs(u - v) < 1e-9 for u, v in zip(b1, b2)) and abs(r2_1 - r2_2) < 1e-9
    ratio = (se2[1] / se1[1]) ** 2
    assert abs(ratio - (n - 2) / (2 * n - 2)) < 1e-9


@check("stat-regression-005")
def _():
    rng = random.Random(65)
    n = 100
    x1 = [rng.gauss(0, 1) for _ in range(n)]
    # exact copy: singular X'X
    cols = [[1.0] * n, x1, list(x1)]
    xtx = [[sum(a * b for a, b in zip(c1, c2)) for c2 in cols] for c1 in cols]
    assert abs(det(xtx)) < 1e-6 * max(abs(v) for row in xtx for v in row) ** 3
    # near copy: individual coefficients swing, their sum and R^2 are stable
    singles, sums, r2s = [], [], []
    for _ in range(200):
        x1 = [rng.gauss(0, 1) for _ in range(n)]
        x2 = [a + rng.gauss(0, 0.01) for a in x1]
        y = [a + rng.gauss(0, 1) for a in x1]
        b, se, _, r2 = ols_fit([[1.0] * n, x1, x2], y)
        singles.append(b[1])
        sums.append(b[1] + b[2])
        r2s.append(r2)
    assert math.sqrt(var(singles)) > 20 * math.sqrt(var(sums))
    assert abs(mean(sums) - 1) < 0.05 and abs(mean(singles) - 0.5) < 2  # unbiased, just noisy
    # ridge splits the weight between identical columns
    x1 = [rng.gauss(0, 1) for _ in range(n)]
    y = [a + rng.gauss(0, 0.5) for a in x1]
    _, r1, r2 = ols([[1.0] * n, x1, list(x1)], y, ridge=1.0)
    assert abs(r1 - r2) < 1e-9


@check("stat-regression-006")
def _():
    rng = random.Random(66)
    slopes = []
    for _ in range(1600):
        x1, y = [], []
        for _ in range(1000):
            a = rng.gauss(0, 1)
            b = 0.6 * a + 0.8 * rng.gauss(0, 1)
            x1.append(a)
            y.append(a - 2 * b + rng.gauss(0, 1))
        slopes.append(slope(x1, y))
    return batch_estimate(slopes)


@check("stat-regression-007")
def _():
    # orthonormal centred vectors u, v, w built from random data
    rng = random.Random(67)
    n = 50
    raw = [[rng.gauss(0, 1) for _ in range(n)] for _ in range(3)]
    u, v, w = orthonormal_columns([[1.0] * n] + raw)[1:]
    r1, r2 = math.sqrt(0.1), math.sqrt(0.2)
    # upper end: x1 and x2 in the plane of y = u, so y is an exact combination of them
    x1 = [r1 * a + math.sqrt(1 - r1 * r1) * b for a, b in zip(u, v)]
    x2 = [r2 * a - math.sqrt(1 - r2 * r2) * b for a, b in zip(u, v)]
    y = list(u)
    assert abs(corr(x1, y) ** 2 - 0.1) < 1e-9 and abs(corr(x2, y) ** 2 - 0.2) < 1e-9
    top = ols_fit([[1.0] * n, x1, x2], y)[3]
    # lower end: x2 = r2 u + s v; x1 = (r1/r2) x2 + noise orthogonal to everything
    s2 = math.sqrt(1 - r2 * r2)
    x2 = [r2 * a + s2 * b for a, b in zip(u, v)]
    k = r1 / r2
    x1 = [k * a + math.sqrt(1 - k * k) * c for a, c in zip(x2, w)]
    assert abs(corr(x1, y) ** 2 - 0.1) < 1e-9 and abs(corr(x2, y) ** 2 - 0.2) < 1e-9
    bottom = ols_fit([[1.0] * n, x1, x2], y)[3]
    assert abs(top - 1) < 1e-9 and abs(bottom - 0.2) < 1e-9
    return "c"


@check("stat-regression-008")
def _():
    rng = random.Random(68)
    n = 20_000
    skill = [rng.gauss(0, 1) for _ in range(n)]
    last = [s + rng.gauss(0, 1) for s in skill]
    this = [s + rng.gauss(0, 1) for s in skill]
    cut = sorted(last)[int(0.9 * n)]
    top = [i for i in range(n) if last[i] >= cut]
    kept = mean([this[i] for i in top]) / mean([last[i] for i in top])
    assert abs(kept - 0.5) < 0.03  # half the variance is luck: half the excess is kept
    low = sorted(last)[int(0.1 * n)]
    bottom = [i for i in range(n) if last[i] <= low]
    assert mean([this[i] for i in bottom]) > mean([last[i] for i in bottom]) + 0.5


@check("stat-regression-009")
def _():
    rho = 0.1
    sim = simulate(
        lambda r: (lambda f: f * (rho * f + math.sqrt(1 - rho * rho) * r.gauss(0, 1)))(r.gauss(0, 1)),
        n=200_000,
        seed=69,
    )
    second = simulate(
        lambda r: (lambda f: (f * (rho * f + math.sqrt(1 - rho * rho) * r.gauss(0, 1))) ** 2)(r.gauss(0, 1)),
        n=200_000,
        seed=69,
    )
    daily_sharpe = sim.mean / math.sqrt(second.mean - sim.mean**2)
    assert abs(daily_sharpe - rho / math.sqrt(1 + rho * rho)) < 0.006
    assert abs(rho / math.sqrt(1 + rho * rho) * math.sqrt(252) - 1.58) < 0.01
    # spurious R^2 between two independent random walks (price levels)
    rng = random.Random(70)
    big = 0
    for _ in range(200):
        a, b = random_walk(rng, 250), random_walk(rng, 250)
        big += corr(a, b) ** 2 > 0.3
    assert big / 200 > 0.2


@check("stat-regression-010")
def _():
    rng = random.Random(71)
    n, reps = 50, 1500
    hetero, collinear, attenuated, autocorr = [], [], [], []
    for _ in range(reps):
        x = [rng.gauss(0, 1) for _ in range(n)]
        # heteroskedastic errors with sd proportional to |x|
        hetero.append(slope(x, [2 * a + abs(a) * rng.gauss(0, 1) for a in x]))
        # collinear regressors (correlation 0.98), true coefficients 1 and 1
        z = [0.98 * a + math.sqrt(1 - 0.98**2) * rng.gauss(0, 1) for a in x]
        y = [a + b + rng.gauss(0, 1) for a, b in zip(x, z)]
        collinear.append(ols([[1.0] * n, x, z], y)[1])
        # x observed with noise of variance 1: slope halves
        attenuated.append(slope([a + rng.gauss(0, 1) for a in x], [2 * a + rng.gauss(0, 1) for a in x]))
        # AR(1) errors independent of x
        e, errs = 0.0, []
        for _ in range(n):
            e = 0.8 * e + rng.gauss(0, 1)
            errs.append(e)
        autocorr.append(slope(x, [2 * a + b for a, b in zip(x, errs)]))
    assert abs(mean(hetero) - 2) < 0.03 and abs(mean(autocorr) - 2) < 0.06
    assert abs(mean(collinear) - 1) < 0.1 and math.sqrt(var(collinear)) > 0.5
    assert abs(mean(attenuated) - 1) < 0.05
    # non-normal (uniform) errors: still unbiased
    nonnormal = [slope(x, [2 * a + rng.uniform(-2, 2) for a in x]) for x in ([rng.gauss(0, 1) for _ in range(n)] for _ in range(reps))]
    assert abs(mean(nonnormal) - 2) < 0.03
    return {"a", "c", "e", "f"}


@check("stat-regression-011")
def _():
    rng = random.Random(72)
    slopes = []
    for _ in range(300):
        xs, ys = [], []
        for _ in range(1000):
            true = rng.gauss(0, 1)
            xs.append(true + rng.gauss(0, 0.5))
            ys.append(true + rng.gauss(0, 1))
        slopes.append(slope(xs, ys))
    return batch_estimate(slopes)


@check("stat-regression-012")
def _():
    rng = random.Random(73)
    n = 200
    x1 = [rng.gauss(0, 1) for _ in range(n)]
    x2 = [0.5 * a + rng.gauss(0, 1) for a in x1]
    y = [a + 0.7 * b + rng.gauss(0, 1) for a, b in zip(x1, x2)]
    short = ols([[1.0] * n, x1], y)[1]
    _, l1, l2 = ols([[1.0] * n, x1, x2], y)
    delta = slope(x1, x2)
    assert abs(short - (l1 + l2 * delta)) < 1e-9
    # FWL: the long coefficient is the slope of y on x1 residualised on x2
    a, b = ols([[1.0] * n, x2], x1)
    resid = [u - a - b * v for u, v in zip(x1, x2)]
    assert abs(slope(resid, y) - l1) < 1e-9
    # x2 orthogonal to x1 in the sample: coefficient unchanged, standard error falls
    z = orthonormal_columns([[1.0] * n, x1, [rng.gauss(0, 1) for _ in range(n)]])[2]
    y2 = [a + 3 * b + rng.gauss(0, 1) for a, b in zip(x1, z)]
    b_s, se_s, _, _ = ols_fit([[1.0] * n, x1], y2)
    b_l, se_l, _, _ = ols_fit([[1.0] * n, x1, z], y2)
    assert abs(b_s[1] - b_l[1]) < 1e-9 and se_l[1] < se_s[1]
    # a redundant regressor highly correlated with x1: standard error rises
    w = [a + rng.gauss(0, 0.1) for a in x1]
    y3 = [a + rng.gauss(0, 1) for a in x1]
    _, se_a, _, _ = ols_fit([[1.0] * n, x1], y3)
    _, se_b, _, _ = ols_fit([[1.0] * n, x1, w], y3)
    assert se_b[1] > 3 * se_a[1]


# ---------------------------------------------------------------- correlation and the Sharpe ratio


@check("stat-correlation-001")
def _():
    rng = random.Random(81)
    rs = [corr(random_walk(rng, 1000), random_walk(rng, 1000)) for _ in range(300)]
    wide = sum(abs(r) > 0.5 for r in rs) / len(rs)
    assert wide > 0.2 and abs(mean(rs)) < 0.1 and 0.35 < math.sqrt(var(rs)) < 0.65
    # the steps themselves are within 2/sqrt(1000) about 95% of the time
    steps = sum(abs(corr([rng.gauss(0, 1) for _ in range(1000)], [rng.gauss(0, 1) for _ in range(1000)])) < 2 / math.sqrt(1000) for _ in range(300))
    assert steps / 300 > 0.9
    return "b"


@check("stat-correlation-002")
def _():
    # exact null density of r for n = 100 is proportional to (1 - r^2)^((n - 4)/2)
    n = 100

    def dens(r):
        return (1 - r * r) ** ((n - 4) / 2)

    total = simpson(dens, -1, 1, 20_000)

    def tail(c):
        return 2 * simpson(dens, c, 1, 20_000) / total - 0.05

    crit = bisect(tail, 0.05, 0.5, iters=60)
    assert abs(crit - 0.1966) < 0.001
    return crit


@check("stat-correlation-003")
def _():
    rng = random.Random(83)
    rs, rhos = [], []
    for _ in range(200):
        x = [rng.gauss(0, 1) for _ in range(49)] + [10.0]
        y = [rng.gauss(0, 1) for _ in range(49)] + [10.0]
        rs.append(corr(x, y))
        rhos.append(corr(ranks(x), ranks(y)))
    assert 0.6 < mean(rs) < 0.72 and mean(rhos) < 0.1
    assert abs(2 / math.sqrt(50) - 0.28) < 0.005


@check("stat-correlation-004")
def _():
    # simulate years of 252 daily returns; annual mean over annual sd
    rng = random.Random(84)
    years = [sum(rng.gauss(0.0005, 0.01) for _ in range(252)) for _ in range(4000)]
    sr = mean(years) / math.sqrt(var(years))
    assert abs(sr - 0.79) < 0.05
    options = {"a": 0.05, "b": 0.79, "c": 0.95, "d": 12.6}
    return min(options, key=lambda k: abs(options[k] - sr))


@check("stat-correlation-005")
def _():
    daily_mu, daily_sd = 4 / 256, 1 / math.sqrt(256)  # annual Sharpe 4 with unit annual vol
    threshold = STD.cdf(-2)
    n = next(k for k in range(1, 10_000) if NormalDist(k * daily_mu, math.sqrt(k) * daily_sd).cdf(0) <= threshold + 1e-15)
    month = NormalDist(21 * daily_mu, math.sqrt(21) * daily_sd).cdf(0)
    assert abs(month - 0.126) < 0.002
    return n


@check("stat-correlation-006")
def _():
    # a four-point joint distribution: A = 1 + U, B = 1 + U/2 + (sqrt 3 / 2) V, U, V = +-1
    pts = []
    for u in (-1, 1):
        for v in (-1, 1):
            pts.append((1 + u, 1 + u / 2 + math.sqrt(3) / 2 * v))
    ma, mb = mean([a for a, _ in pts]), mean([b for _, b in pts])
    va = mean([(a - ma) ** 2 for a, _ in pts])
    vb = mean([(b - mb) ** 2 for _, b in pts])
    cab = mean([(a - ma) * (b - mb) for a, b in pts])
    assert abs(ma / math.sqrt(va) - 1) < 1e-12 and abs(mb / math.sqrt(vb) - 1) < 1e-12 and abs(cab / math.sqrt(va * vb) - 0.5) < 1e-12
    s = [a + b for a, b in pts]
    return mean(s) / math.sqrt(mean([(x - mean(s)) ** 2 for x in s]))


@check("stat-correlation-007")
def _():
    rng = random.Random(87)
    xs, ys = [], []
    for _ in range(100_000):
        if rng.random() < 0.05:  # crisis day: both fall
            xs.append(-3 + rng.gauss(0, 1))
            ys.append(-3 + rng.gauss(0, 1))
        else:  # ordinary day: a mild hedge
            a = rng.gauss(0, 1)
            xs.append(a)
            ys.append(-0.6 * a + 0.8 * rng.gauss(0, 1))
    r = corr(xs, ys)
    assert abs(r) < 0.1, r
    qx, qy = sorted(xs)[5000], sorted(ys)[5000]
    joint = sum(1 for a, b in zip(xs, ys) if a <= qx and b <= qy) / 100_000
    assert joint / 0.05 > 0.5  # P(Y in worst 5% | X in worst 5%) far above 5%


@check("stat-correlation-008")
def _():
    rng = random.Random(88)
    years, sr = 4, 1.0
    mu, sd = sr / 252, 1 / math.sqrt(252)
    daily, monthly = [], []
    for _ in range(1500):
        r = [rng.gauss(mu, sd) for _ in range(252 * years)]
        daily.append(mean(r) / math.sqrt(var(r)) * math.sqrt(252))
        m = [sum(r[i : i + 21]) for i in range(0, len(r), 21)]
        monthly.append(mean(m) / math.sqrt(var(m)) * math.sqrt(12))
    se_d, se_m = math.sqrt(var(daily)), math.sqrt(var(monthly))
    assert abs(se_d - 0.5) < 0.04 and abs(se_m - 0.5 * math.sqrt(1 + (sr / math.sqrt(12)) ** 2 / 2)) < 0.05
    assert se_m / se_d < 1.15  # monthly sampling is barely worse


# ---------------------------------------------------------------- time series


def garch(rng, n, omega=0.05, alpha=0.1, beta=0.85):
    s2 = omega / (1 - alpha - beta)
    out = []
    for _ in range(n):
        r = math.sqrt(s2) * rng.gauss(0, 1)
        out.append(r)
        s2 = omega + alpha * r * r + beta * s2
    return out


def autocorr(xs, lag):
    m = mean(xs)
    num = sum((xs[t] - m) * (xs[t - lag] - m) for t in range(lag, len(xs)))
    return num / sum((x - m) ** 2 for x in xs)


@check("stat-time-series-001")
def _():
    rng = random.Random(91)
    # the variance of a random walk's level grows linearly; its steps' variance does not
    ends = {100: [], 400: []}
    for _ in range(2000):
        w = random_walk(rng, 400)
        ends[100].append(w[99])
        ends[400].append(w[399])
    assert 3 < var(ends[400]) / var(ends[100]) < 5
    return "a"


@check("stat-time-series-002")
def _():
    # expected deviation after k days, run forward in steps of 1/1000 day between 6 and 7
    k = bisect(lambda k: 0.9**k - 0.5, 0, 20)
    assert 0.9**6 > 0.5 > 0.9**7
    return k


@check("stat-time-series-003")
def _():
    v = 0.0
    for _ in range(500):  # iterate Var(x_t) = 0.64 Var(x_{t-1}) + 1 from 0
        v = 0.64 * v + 1
    rng = random.Random(93)
    x, xs = 0.0, []
    for t in range(400_000):
        x = 0.8 * x + rng.gauss(0, 1)
        if t > 100:
            xs.append(x)
    assert abs(var(xs) - 25 / 9) < 0.05
    options = {"a": 25 / 9, "b": 5.0, "c": 1.0, "d": 1.64}
    return min(options, key=lambda key: abs(options[key] - v))


@check("stat-time-series-004")
def _():
    # an MA(1) with lag-1 autocorrelation 0.1: r_t = e_t + theta e_{t-1}, theta / (1 + theta^2) = 0.1
    theta = bisect(lambda t: t / (1 + t * t) - 0.1, 0, 1)
    # the 10-day sum as a combination of e_0, ..., e_10: coefficients theta, 1 + theta, ..., 1
    coeffs = [theta] + [1 + theta] * 9 + [1]
    var10 = sum(c * c for c in coeffs)
    var1 = 1 + theta * theta
    return math.sqrt(var10 / (10 * var1))


@check("stat-time-series-005")
def _():
    rng = random.Random(95)
    ts, bs = [], []
    for _ in range(2000):
        p = random_walk(rng, 251)
        dp = [p[t] - p[t - 1] for t in range(1, 251)]
        lag = p[:250]
        beta, se, _, _ = ols_fit([[1.0] * 250, lag], dp)
        ts.append(beta[1] / se[1])
        bs.append(beta[1])
    ts.sort()
    q05 = ts[100]
    assert -3.1 < q05 < -2.6, q05
    share = sum(t < -2.2 for t in ts) / len(ts)
    assert 0.12 < share < 0.3, share
    assert mean(bs) < -0.01  # biased negative, around -5.5/250
    assert sum(t < -1.645 for t in ts) / len(ts) > 0.3


@check("stat-time-series-006")
def _():
    def trial(r):
        d = [r.gauss(0, 1) for _ in range(21)]
        return sum(d[:20]) * sum(d[1:]) / 20

    # also: naive OLS standard errors when both sides are overlapping 20-day sums
    rng = random.Random(96)
    betas, naive = [], []
    for _ in range(300):
        a = [rng.gauss(0, 1) for _ in range(519)]
        b = [rng.gauss(0, 1) for _ in range(519)]
        x = [sum(a[i : i + 20]) for i in range(500)]
        y = [sum(b[i : i + 20]) for i in range(500)]
        beta, se, _, _ = ols_fit([[1.0] * 500, x], y)
        betas.append(beta[1])
        naive.append(se[1])
    ratio = math.sqrt(var(betas)) / mean(naive)
    assert 2.8 < ratio < 4.6, ratio
    return simulate(trial, n=60_000, seed=96)


@check("stat-time-series-007")
def _():
    rng = random.Random(97)
    # GARCH: the conditional variance mean-reverts, so 10 x today's high variance overstates
    # the expected 10-day variance when today is a high-volatility day
    omega, alpha, beta = 0.05, 0.1, 0.85
    long_run = omega / (1 - alpha - beta)
    s2 = 4 * long_run
    expected = 0.0
    for _ in range(10):
        expected += s2
        s2 = omega + (alpha + beta) * s2
    assert expected < 0.9 * 10 * 4 * long_run
    # fat tails: the 99% quantile of a 10-day sum of t(3) returns is not sqrt(10) x the daily one
    def t3():
        z = rng.gauss(0, 1)
        return z / math.sqrt(sum(rng.gauss(0, 1) ** 2 for _ in range(3)) / 3)

    one = sorted(t3() for _ in range(100_000))[990]
    ten = sorted(sum(t3() for _ in range(10)) for _ in range(30_000))[297]
    assert abs(ten / one / math.sqrt(10) - 1) > 0.05


@check("stat-time-series-008")
def _():
    rng = random.Random(98)
    reps = 1500
    procs = {k: {20: [], 400: []} for k in "abcdef"}
    for _ in range(reps):
        g = garch(rng, 400)
        rw, rwd, ar, tr, fx, fy = [], [], [], [], [], []
        p = q = 0.0
        x = rng.gauss(0, math.sqrt(4 / 3))
        common = 0.0
        for t in range(1, 401):
            e = rng.gauss(0, 1)
            p += e
            q += 0.05 + e
            x = 0.5 * x + rng.gauss(0, 1)
            common += rng.gauss(0, 1)
            rw.append(p)
            rwd.append(q)
            ar.append(x)
            tr.append(0.1 * t + rng.gauss(0, 1))
            fx.append(common)
            fy.append(2 * common + rng.gauss(0, 1))
        series = {"a": g, "b": rw, "c": ar, "d": tr, "e": rwd, "f": [b - 2 * a for a, b in zip(fx, fy)]}
        for k, s in series.items():
            for t in (20, 400):
                procs[k][t].append(s[t - 1])
    stationary = set()
    for k, d in procs.items():
        m20, m400 = mean(d[20]), mean(d[400])
        v20, v400 = var(d[20]), var(d[400])
        if abs(m400 - m20) < 0.5 and 0.8 < v400 / v20 < 1.25:
            stationary.add(k)
    return stationary


@check("stat-time-series-009")
def _():
    rng = random.Random(99)
    # unrelated random walks: |level correlation| > 0.5 is common
    big = sum(abs(corr(random_walk(rng, 1250), random_walk(rng, 1250))) > 0.5 for _ in range(200))
    assert big / 200 > 0.2
    # highly correlated returns but a spread that drifts: common shocks plus a small drift difference
    xs, ys, px, py = [], [], 0.0, 0.0
    for _ in range(1250):
        c = rng.gauss(0, 1)
        px += c + 0.1 * rng.gauss(0, 1)
        py += c + 0.1 * rng.gauss(0, 1) + 0.02
        xs.append(px)
        ys.append(py)
    rx = [xs[i] - xs[i - 1] for i in range(1, 1250)]
    ry = [ys[i] - ys[i - 1] for i in range(1, 1250)]
    spread = [b - a for a, b in zip(xs, ys)]
    assert corr(rx, ry) > 0.95 and spread[-1] - spread[0] > 15
    # a cointegrated pair with weakly correlated returns
    xs, ys, p = [], [], 0.0
    for _ in range(1250):
        p += 0.2 * rng.gauss(0, 1)
        xs.append(p + rng.gauss(0, 1))
        ys.append(p + rng.gauss(0, 1))
    rx = [xs[i] - xs[i - 1] for i in range(1, 1250)]
    ry = [ys[i] - ys[i - 1] for i in range(1, 1250)]
    spread = [b - a for a, b in zip(xs, ys)]
    assert corr(rx, ry) < 0.1 and abs(autocorr(spread, 1)) < 0.1


@check("stat-time-series-010")
def _():
    rng = random.Random(100)
    r = garch(rng, 100_000)
    assert abs(autocorr(r, 1)) < 0.02
    sq = [x * x for x in r]
    assert autocorr(sq, 1) > 0.1 and autocorr(sq, 10) > 0.05
    m, s = mean(r), math.sqrt(var(r))
    kurt = mean([((x - m) / s) ** 4 for x in r])
    assert kurt > 3.5  # conditionally normal, unconditionally fat-tailed


# ---------------------------------------------------------------- model validation and backtesting


def expected_max_normal(n):
    """E[max of n i.i.d. standard normals], by integrating the distribution function."""
    upper = simpson(lambda x: 1 - STD.cdf(x) ** n, 0, 10, 8000)
    lower = simpson(lambda x: STD.cdf(x) ** n, -10, 0, 8000)
    return upper - lower


@check("stat-backtesting-001")
def _():
    # a leaky signal (it sees today's return) collapses when execution is delayed by one day;
    # a genuine but slow signal (it predicts the next two days) only weakens
    rng = random.Random(101)
    n = 20_000
    r = [rng.gauss(0, 1) for _ in range(n + 3)]
    leak = [r[t] + rng.gauss(0, 3) for t in range(n)]  # uses the same day's return
    slow = [r[t + 1] + r[t + 2] + rng.gauss(0, 6) for t in range(n)]  # predicts the next two days

    def sharpe(sig, delay):
        pnl = [sig[t] * r[t + delay] for t in range(n)]
        return mean(pnl) / math.sqrt(var(pnl))

    assert sharpe(leak, 0) > 0.25 and abs(sharpe(leak, 1)) < 0.03
    assert sharpe(slow, 1) > 0.08 and sharpe(slow, 2) > 0.5 * sharpe(slow, 1)


@check("stat-backtesting-002")
def _():
    em = expected_max_normal(100)
    assert abs(em - 2.5076) < 0.0005
    return simulate(lambda r: max(r.gauss(0, 0.5) for _ in range(100)), n=20_000, seed=102)


@check("stat-backtesting-003")
def _():
    # labels are overlapping 20-day forward sums of i.i.d. returns; the "model" predicts a test
    # day's label by the label of the nearest training day. Random folds leak; purged folds do not.
    rng = random.Random(103)
    n = 3000
    r = [rng.gauss(0, 1) for _ in range(n + 20)]
    y = [sum(r[t + 1 : t + 21]) for t in range(n)]
    days = list(range(n))
    rng.shuffle(days)
    folds = [set(days[k::5]) for k in range(5)]

    def cv(purge):
        preds, actual = [], []
        for test in folds:
            train_set = set(range(n)) - test
            for t in sorted(test):
                best = None
                for gap in range(purge + 1, n):
                    for c in (t - gap, t + gap):
                        if c in train_set:
                            best = c
                            break
                    if best is not None:
                        break
                preds.append(y[best])
                actual.append(y[t])
        return corr(preds, actual)

    leaky = cv(0)
    purged = cv(20)
    # overlapping labels make the purged correlation noisy (about 150 independent points)
    assert leaky > 0.85 and abs(purged) < 0.3
    return "a"


@check("stat-backtesting-004")
def _():
    # R^2 depends only on the projection of y on the span of the features (with the intercept);
    # project onto an orthonormal basis of a fixed random design
    rng = random.Random(104)
    n, p = 200, 50
    design = [[1.0] * n] + [[rng.gauss(0, 1) for _ in range(n)] for _ in range(p)]
    q = orthonormal_columns(design)[1:]  # basis of the features' span, orthogonal to the intercept

    def trial(r):
        yv = [r.gauss(0, 1) for _ in range(n)]
        m = sum(yv) / n
        yc = [v - m for v in yv]
        explained = sum(sum(a * b for a, b in zip(col, yc)) ** 2 for col in q)
        return explained / sum(v * v for v in yc)

    return simulate(trial, n=600, seed=1104)  # a seed unrelated to the design's


@check("stat-backtesting-005")
def _():
    # simulate the t-statistic with known volatility from 16 years of monthly returns
    months = 16 * 12
    mu, sd = 0.5 / 12, 1 / math.sqrt(12)

    def trial(r):
        total = sum(r.gauss(mu, sd) for _ in range(months))
        return (total / months) / (sd / math.sqrt(months))

    sim = simulate(trial, n=8000, seed=105)
    assert abs(sim.mean - 2) < 4 * sim.stderr
    return next(t for t in range(1, 100) if 0.5 * math.sqrt(t) >= 2)


@check("stat-backtesting-006")
def _():
    em = expected_max_normal(200)
    assert abs(em - 2.75) < 0.01
    assert abs(em / math.sqrt(10) - 0.87) < 0.005


@check("stat-backtesting-007")
def _():
    # b: full-sample standardisation leaks: a signal z-scored with the full-sample mean of a
    # trending series "knows" whether the future is above or below today
    rng = random.Random(107)
    leaks = 0
    for _ in range(300):
        p = random_walk(rng, 500)
        m = mean(p)
        # sign of (p_t - full-sample mean) predicts the sign of the future drift towards the mean
        hits = sum((p[t] - m) * (p[-1] - p[t]) < 0 for t in range(0, 400))
        leaks += hits > 200
    assert leaks / 300 > 0.6
    return {"a", "b", "c", "f"}


@check("stat-backtesting-008")
def _():
    # standard error of a one-year Sharpe estimate is about 1; selection inflates in-sample numbers
    rng = random.Random(108)
    est = []
    for _ in range(2000):
        r = [rng.gauss(1 / 252, 1 / math.sqrt(252)) for _ in range(252)]
        est.append(mean(r) / math.sqrt(var(r)) * math.sqrt(252))
    assert abs(math.sqrt(var(est)) - 1) < 0.06
    # pick the best of 20 strategies with true Sharpe 1 over 5 years: its in-sample Sharpe overstates
    best = [max(1 + rng.gauss(0, 1 / math.sqrt(5)) for _ in range(20)) for _ in range(2000)]
    assert mean(best) > 1.6


# ---------------------------------------------------------------- regularisation and model complexity


@check("stat-ml-001")
def _():
    # polynomial fits of increasing degree to noisy data: training error falls, test error is U-shaped
    rng = random.Random(111)

    def f(x):
        return math.sin(3 * x)

    xs = [i / 29 * 2 - 1 for i in range(30)]
    train_err, test_err = {}, {}
    for degree in (1, 3, 12):
        tr = te = 0.0
        for _ in range(100):
            y = [f(x) + rng.gauss(0, 0.5) for x in xs]
            cols = [[x**k for x in xs] for k in range(degree + 1)]
            b = ols(cols, y, ridge=1e-9)
            fit = [sum(bk * x**k for k, bk in enumerate(b)) for x in xs]
            tr += mean([(a - c) ** 2 for a, c in zip(y, fit)])
            te += mean([(f(x) + rng.gauss(0, 0.5) - c) ** 2 for x, c in zip(xs, fit)])
        train_err[degree], test_err[degree] = tr / 100, te / 100
    assert train_err[1] > train_err[3] > train_err[12]
    assert test_err[3] < test_err[1] and test_err[3] < test_err[12]


@check("stat-ml-002")
def _():
    b, lam = 0.3, 0.5
    ridge = b / (1 + lam)
    # lasso on one orthonormal column: minimise (1/2)(beta - b)^2 + lam |beta| on a fine grid
    grid = [i / 10_000 for i in range(-20_000, 20_001)]
    lasso = min(grid, key=lambda beta: 0.5 * (beta - b) ** 2 + lam * abs(beta))
    assert lasso == 0 and ridge != 0
    return "a"


@check("stat-ml-003")
def _():
    rng = random.Random(113)
    n = 60
    x = [rng.gauss(0, 1) for _ in range(n)]
    y = [1.5 * v + rng.gauss(0, 1) for v in x]
    yc, xc = centred(y), centred(x)
    lam = 4.0
    # d: identical columns get equal weights; their sum is the one-copy ridge with lam/2
    b1, b2 = ols([xc, list(xc)], yc, ridge=lam)
    one = ols([xc], yc, ridge=lam / 2)[0]
    assert abs(b1 - b2) < 1e-9 and abs(b1 + b2 - one) < 1e-9
    # c: rescaling a feature changes the ridge fit
    fit = ols([xc], yc, ridge=lam)[0] * xc[0]
    fit_scaled = ols([[100 * v for v in xc]], yc, ridge=lam)[0] * 100 * xc[0]
    assert abs(fit - fit_scaled) > 1e-3
    # f: ridge is biased towards zero (shrinks the OLS coefficient)
    assert abs(ols([xc], yc, ridge=lam)[0]) < abs(ols([xc], yc)[0])
    # a: ridge equals the MAP with a normal prior of variance sigma^2 / lam (here sigma^2 = 1)
    tau2 = 1 / lam
    r = ols([xc], yc, ridge=lam)[0]
    post = lambda c: -sum((a - c * b) ** 2 for a, b in zip(yc, xc)) / 2 - c * c / (2 * tau2)
    assert abs(argmax_unimodal(post, -10, 10) - r) < 1e-6
    # b: lasso equals the MAP with a Laplace prior of scale 1/lam
    lap = lambda c: -sum((a - c * b) ** 2 for a, b in zip(yc, xc)) / 2 - lam * abs(c)
    sxx, sxy = sum(v * v for v in xc), sum(a * b for a, b in zip(xc, yc))
    soft = math.copysign(max(abs(sxy) - lam, 0) / sxx, sxy)
    assert abs(argmax_unimodal(lap, -10, 10) - soft) < 1e-6
    return {"a", "b", "d", "f"}


@check("stat-ml-004")
def _():
    # an orthonormal design with OLS coefficients (2, -1), solved with Fractions
    half = Fraction(1, 2)
    c1 = [half, half, half, half]
    c2 = [half, -half, half, -half]
    y = [2 * a - b + e for a, b, e in zip(c1, c2, (Fraction(1, 10), Fraction(-1, 10), Fraction(-1, 10), Fraction(1, 10)))]
    assert ols([c1, c2], y) == [2, -1]
    return ols([c1, c2], y, ridge=Fraction(1, 4))[0]


@check("stat-ml-005")
def _():
    # low signal-to-noise: a 10-feature OLS fit on 250 points loses to a 1-feature fit out of sample
    rng = random.Random(115)
    wins = 0
    for _ in range(200):
        n = 250
        feats = [[rng.gauss(0, 1) for _ in range(n)] for _ in range(10)]
        y = [0.05 * feats[0][i] + rng.gauss(0, 1) for i in range(n)]
        test_f = [[rng.gauss(0, 1) for _ in range(n)] for _ in range(10)]
        test_y = [0.05 * test_f[0][i] + rng.gauss(0, 1) for i in range(n)]
        big = ols([[1.0] * n] + feats, y)
        small = ols([[1.0] * n, feats[0]], y)
        e_big = mean([(test_y[i] - big[0] - sum(big[k + 1] * test_f[k][i] for k in range(10))) ** 2 for i in range(n)])
        e_small = mean([(test_y[i] - small[0] - small[1] * test_f[0][i]) ** 2 for i in range(n)])
        wins += e_small < e_big
    assert wins / 200 > 0.75


@check("stat-ml-006")
def _():
    rng = random.Random(116)
    n, p = 50, 10
    design = [[1.0] * n] + [[rng.gauss(0, 1) for _ in range(n)] for _ in range(p - 1)]
    q = orthonormal_columns(design)  # H = Q Q^T

    def trial(r):
        e = [r.gauss(0, 1) for _ in range(n)]
        fresh = [r.gauss(0, 1) for _ in range(n)]
        coef = [sum(a * b for a, b in zip(col, e)) for col in q]
        he = [sum(c * col[i] for c, col in zip(coef, q)) for i in range(n)]
        train = sum((a - b) ** 2 for a, b in zip(e, he)) / n
        test = sum((a - b) ** 2 for a, b in zip(fresh, he)) / n
        return test - train

    return simulate(trial, n=12_000, seed=1116)  # a seed unrelated to the design's


@check("stat-ml-007")
def _():
    # lasso on two nearly identical features picks one and its choice flips across samples;
    # ridge splits the weight evenly every time
    rng = random.Random(117)

    def lasso2(x1, x2, y, lam, iters=300):
        b1 = b2 = 0.0
        s11, s22 = sum(v * v for v in x1), sum(v * v for v in x2)
        for _ in range(iters):  # coordinate descent
            r1 = sum(a * (c - b2 * b) for a, b, c in zip(x1, x2, y))
            b1 = math.copysign(max(abs(r1) - lam, 0) / s11, r1)
            r2 = sum(b * (c - b1 * a) for a, b, c in zip(x1, x2, y))
            b2 = math.copysign(max(abs(r2) - lam, 0) / s22, r2)
        return b1, b2

    picks, ridge_gaps = set(), []
    for _ in range(20):
        common = [rng.gauss(0, 1) for _ in range(100)]
        x1 = centred([c + rng.gauss(0, 0.1) for c in common])
        x2 = centred([c + rng.gauss(0, 0.1) for c in common])
        y = centred([c + rng.gauss(0, 1) for c in common])
        l1, l2 = lasso2(x1, x2, y, lam=10.0)
        picks.add("first" if abs(l1) > abs(l2) else "second")
        r1, r2 = ols([x1, x2], y, ridge=50.0)
        ridge_gaps.append(abs(r1 - r2) / abs(r1 + r2))
    assert picks == {"first", "second"} and max(ridge_gaps) < 0.1
