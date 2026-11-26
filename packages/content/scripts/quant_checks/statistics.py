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
