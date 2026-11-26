"""Checks for quiz/algebra-calculus: each recomputes an answer by a different route from the explanation.

Linear algebra is done exactly with Fractions (Gaussian elimination for ranks and determinants, the
Faddeev-LeVerrier recursion for characteristic polynomials, principal minors for semidefiniteness)
or numerically (Jacobi rotations, power iteration, Durand-Kerner roots, grid and golden-section
searches). Integrals use composite Simpson (on a graded mesh near a singular endpoint), series use
partial sums, and differential equations use Runge-Kutta. Random matrices are seeded.
"""

from __future__ import annotations

import itertools
import math
import random
from fractions import Fraction

from . import check, simulate

F = Fraction

# ---------------------------------------------------------------- exact matrix helpers


def mat(rows) -> list[list[Fraction]]:
    return [[F(x) for x in r] for r in rows]


def identity(n: int) -> list[list[Fraction]]:
    return [[F(int(i == j)) for j in range(n)] for i in range(n)]


def transpose(a):
    return [list(r) for r in zip(*a)]


def matmul(a, b):
    bt = transpose(b)
    return [[sum((x * y for x, y in zip(r, c)), F(0)) for c in bt] for r in a]


def matvec(a, v):
    return [sum((x * y for x, y in zip(r, v)), F(0)) for r in a]


def add(a, b, s=1):
    return [[x + s * y for x, y in zip(r, q)] for r, q in zip(a, b)]


def scale(a, s):
    return [[s * x for x in r] for r in a]


def trace(a):
    return sum((a[i][i] for i in range(len(a))), F(0))


def dot(u, v):
    return sum((x * y for x, y in zip(u, v)), F(0))


def rref(a):
    """Reduced row echelon form (exact) and the pivot columns."""
    m = [list(map(F, r)) for r in a]
    rows, cols = len(m), len(m[0])
    pivots: list[int] = []
    r = 0
    for c in range(cols):
        piv = next((i for i in range(r, rows) if m[i][c] != 0), None)
        if piv is None:
            continue
        m[r], m[piv] = m[piv], m[r]
        p = m[r][c]
        m[r] = [x / p for x in m[r]]
        for i in range(rows):
            if i != r and m[i][c] != 0:
                f = m[i][c]
                m[i] = [x - f * y for x, y in zip(m[i], m[r])]
        pivots.append(c)
        r += 1
        if r == rows:
            break
    return m, pivots


def rank(a) -> int:
    return len(rref(a)[1])


def det(a) -> Fraction:
    """Determinant by elimination with row swaps (exact)."""
    m = [list(map(F, r)) for r in a]
    n = len(m)
    d = F(1)
    for c in range(n):
        piv = next((i for i in range(c, n) if m[i][c] != 0), None)
        if piv is None:
            return F(0)
        if piv != c:
            m[c], m[piv] = m[piv], m[c]
            d = -d
        d *= m[c][c]
        for i in range(c + 1, n):
            if m[i][c] != 0:
                f = m[i][c] / m[c][c]
                m[i] = [x - f * y for x, y in zip(m[i], m[c])]
    return d


def solve(a, b):
    """Solve the square system a x = b exactly."""
    n = len(a)
    m, piv = rref([list(r) + [bi] for r, bi in zip(a, b)])
    assert piv == list(range(n)), "singular system"
    return [m[i][n] for i in range(n)]


def null_space(a):
    """A basis of {x : a x = 0}, from the free columns of the RREF."""
    m, piv = rref(a)
    n = len(a[0])
    free = [c for c in range(n) if c not in piv]
    basis = []
    for f in free:
        v = [F(0)] * n
        v[f] = F(1)
        for row, p in enumerate(piv):
            v[p] = -m[row][f]
        basis.append(v)
    return basis


def charpoly(a) -> list[Fraction]:
    """Faddeev-LeVerrier: [1, c1, ..., cn] with det(λI - a) = λ^n + c1 λ^(n-1) + ... + cn."""
    n = len(a)
    ident = identity(n)
    m = ident
    coeffs = [F(1)]
    for k in range(1, n + 1):
        am = matmul(a, m)
        ck = -trace(am) / k
        coeffs.append(ck)
        m = add(am, scale(ident, ck))
    return coeffs


def poly_eval(coeffs, x):
    acc = 0
    for c in coeffs:
        acc = acc * x + c
    return acc


def poly_roots(coeffs) -> list[complex]:
    """All complex roots of a monic polynomial (Durand-Kerner)."""
    c = [complex(float(x)) for x in coeffs]
    n = len(c) - 1
    roots = [(0.4 + 0.9j) ** k for k in range(n)]
    for _ in range(2000):
        new = []
        for i, r in enumerate(roots):
            denom = 1
            for j, s in enumerate(roots):
                if i != j:
                    denom *= r - s
            new.append(r - poly_eval(c, r) / denom)
        if max(abs(a - b) for a, b in zip(new, roots)) < 1e-15:
            roots = new
            break
        roots = new
    return roots


def principal_minors_nonneg(a) -> bool:
    n = len(a)
    for k in range(1, n + 1):
        for idx in itertools.combinations(range(n), k):
            if det([[a[i][j] for j in idx] for i in idx]) < 0:
                return False
    return True


def is_psd_exact(a) -> bool:
    return a == transpose(a) and principal_minors_nonneg(a)


def rand_int_matrix(rng: random.Random, m: int, n: int, lo: int = -5, hi: int = 5):
    return [[F(rng.randint(lo, hi)) for _ in range(n)] for _ in range(m)]


# ---------------------------------------------------------------- numerical helpers


def jacobi_eigen(a, sweeps: int = 100):
    """Eigenvalues and eigenvectors (columns) of a real symmetric matrix by cyclic Jacobi rotations."""
    n = len(a)
    m = [[float(x) for x in r] for r in a]
    v = [[float(i == j) for j in range(n)] for i in range(n)]
    for _ in range(sweeps):
        off = sum(m[i][j] ** 2 for i in range(n) for j in range(n) if i != j)
        if off < 1e-24:
            break
        for p in range(n - 1):
            for q in range(p + 1, n):
                if abs(m[p][q]) < 1e-300:
                    continue
                theta = (m[q][q] - m[p][p]) / (2 * m[p][q])
                t = (1 if theta >= 0 else -1) / (abs(theta) + math.sqrt(theta * theta + 1))
                c = 1 / math.sqrt(t * t + 1)
                s = t * c
                for k in range(n):
                    mkp, mkq = m[k][p], m[k][q]
                    m[k][p], m[k][q] = c * mkp - s * mkq, s * mkp + c * mkq
                for k in range(n):
                    mpk, mqk = m[p][k], m[q][k]
                    m[p][k], m[q][k] = c * mpk - s * mqk, s * mpk + c * mqk
                for k in range(n):
                    vkp, vkq = v[k][p], v[k][q]
                    v[k][p], v[k][q] = c * vkp - s * vkq, s * vkp + c * vkq
    return [m[i][i] for i in range(n)], v


def fmatvec(a, x):
    return [sum(float(aij) * xj for aij, xj in zip(row, x)) for row in a]


def power_iteration(a, iters: int = 2000, seed: int = 7):
    """Dominant eigenvalue (by Rayleigh-type ratio) and eigenvector of a real matrix."""
    rng = random.Random(seed)
    x = [rng.random() + 0.5 for _ in range(len(a))]
    lam = 0.0
    for _ in range(iters):
        y = fmatvec(a, x)
        norm = math.sqrt(sum(t * t for t in y))
        lam = sum(yi * xi for yi, xi in zip(y, x)) / sum(xi * xi for xi in x)
        x = [t / norm for t in y]
    return lam, x


def simpson(f, a: float, b: float, n: int = 2000) -> float:
    if n % 2:
        n += 1
    h = (b - a) / n
    s = f(a) + f(b)
    s += 4 * math.fsum(f(a + (2 * k - 1) * h) for k in range(1, n // 2 + 1))
    s += 2 * math.fsum(f(a + 2 * k * h) for k in range(1, n // 2))
    return s * h / 3


def simpson_graded(f, a: float, b: float, levels: int = 60, n: int = 40) -> float:
    """Integral over (a, b] for f singular (but integrable) at a: Simpson on [a + w/2^(k+1), a + w/2^k]."""
    w = b - a
    return math.fsum(simpson(f, a + w / 2 ** (k + 1), a + w / 2**k, n) for k in range(levels))


def golden_min(f, lo: float, hi: float, tol: float = 1e-13) -> float:
    g = (math.sqrt(5) - 1) / 2
    c, d = hi - g * (hi - lo), lo + g * (hi - lo)
    while hi - lo > tol:
        if f(c) < f(d):
            hi = d
        else:
            lo = c
        c, d = hi - g * (hi - lo), lo + g * (hi - lo)
    return (lo + hi) / 2


def rk4(fn, t0: float, y0: list[float], t1: float, steps: int):
    """Integrates y' = fn(t, y) from t0 to t1 with classical Runge-Kutta; returns the trajectory."""
    h = (t1 - t0) / steps
    t, y = t0, list(y0)
    out = [(t, list(y))]
    for _ in range(steps):
        k1 = fn(t, y)
        k2 = fn(t + h / 2, [a + h / 2 * b for a, b in zip(y, k1)])
        k3 = fn(t + h / 2, [a + h / 2 * b for a, b in zip(y, k2)])
        k4 = fn(t + h, [a + h * b for a, b in zip(y, k3)])
        y = [a + h / 6 * (p + 2 * q + 2 * r + s) for a, p, q, r, s in zip(y, k1, k2, k3, k4)]
        t += h
        out.append((t, list(y)))
    return out


def richardson_derivative(f, x: float, h: float) -> float:
    d1 = (f(x + h) - f(x - h)) / (2 * h)
    d2 = (f(x + h / 2) - f(x - h / 2)) / h
    return (4 * d2 - d1) / 3


def Phi(x: float) -> float:
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def phi(x: float) -> float:
    return math.exp(-x * x / 2) / math.sqrt(2 * math.pi)


# ---------------------------------------------------------------- rank and linear systems


@check("lac-rank-001")
def _():
    rng = random.Random(1)
    while True:
        a = matmul(rand_int_matrix(rng, 6, 4), rand_int_matrix(rng, 4, 9))
        if rank(a) == 4:
            break
    basis = null_space(a)
    for v in basis:
        assert all(x == 0 for x in matvec(a, v))
    assert rank(basis) == len(basis)
    return len(basis)


@check("lac-rank-002")
def _():
    no_solution = []
    for k in [F(x, 2) for x in range(-30, 31)]:
        coeff = mat([[1, 1, 1], [1, 2, 3], [2, 3, k]])
        aug = [r + [b] for r, b in zip(coeff, [F(1), F(2), F(4)])]
        if rank(aug) > rank(coeff):
            no_solution.append(k)
        else:
            assert rank(coeff) == 3  # unique solution for every other k
    assert len(no_solution) == 1
    return no_solution[0]


@check("lac-rank-003")
def _():
    a = [[(i + j) ** 2 for j in range(1, 101)] for i in range(1, 101)]
    return rank(a)


@check("lac-rank-004")
def _():
    rng = random.Random(4)
    truth = {}
    # a: a wide matrix has a non-zero null vector (found explicitly)
    ok = True
    for _ in range(20):
        a = rand_int_matrix(rng, 2, 3)
        vs = null_space(a)
        ok &= bool(vs) and all(x == 0 for x in matvec(a, vs[0])) and any(vs[0])
    truth["a"] = ok
    # b: counterexample, a wide matrix with an inconsistent right-hand side
    a = mat([[1, 1, 1], [2, 2, 2]])
    truth["b"] = not rank([r + [b] for r, b in zip(a, [F(1), F(0)])]) > rank(a)
    # c: independent columns leave no room for two solutions (trivial null space)
    ok = True
    for _ in range(20):
        a = rand_int_matrix(rng, 4, 2)
        if rank(a) == 2:
            ok &= null_space(a) == []
    truth["c"] = ok
    # d: a tall matrix misses some right-hand side
    ok = True
    for _ in range(20):
        a = rand_int_matrix(rng, 4, 2)
        found = any(
            rank([r + [x] for r, x in zip(a, e)]) > rank(a)
            for e in ([F(int(i == j)) for i in range(4)] for j in range(4))
        )
        ok &= found
    truth["d"] = ok
    # e: the line through two solutions consists of solutions
    a = mat([[1, 1, 1], [1, 2, 3]])
    b = [F(3), F(6)]
    x1, x2 = [F(1), F(1), F(1)], [F(2), F(-1), F(2)]
    assert matvec(a, x1) == b and matvec(a, x2) == b
    truth["e"] = all(
        matvec(a, [p + t * (q - p) for p, q in zip(x1, x2)]) == b for t in (F(-3), F(1, 7), F(5))
    )
    # f: counterexample A = 0, b = 0
    zero = mat([[0, 0], [0, 0]])
    truth["f"] = rank(zero) == 2
    return {k for k, v in truth.items() if v}


@check("lac-rank-005")
def _():
    ranks = set()
    for entries in itertools.product((-1, 0, 1), repeat=9):
        if not any(entries):
            continue
        a = [list(entries[0:3]), list(entries[3:6]), list(entries[6:9])]
        sq = [[sum(a[i][k] * a[k][j] for k in range(3)) for j in range(3)] for i in range(3)]
        if all(x == 0 for r in sq for x in r):
            ranks.add(rank(a))
    assert len(ranks) == 1
    return ranks.pop()


@check("lac-rank-006")
def _():
    rng = random.Random(6)
    for _ in range(10):
        x = matmul(rand_int_matrix(rng, 5, 2), rand_int_matrix(rng, 2, 4))  # rank <= 2
        assert rank(matmul(transpose(x), x)) == rank(x)
        assert rank(matmul(x, transpose(x))) == rank(x)
    z = [1, 1j]
    assert sum(t * t for t in z) == 0  # plain transpose: zᵀz = 0 for z ≠ 0
    assert sum(t * t.conjugate() for t in z) == 2


# ---------------------------------------------------------------- determinants


@check("lac-det-001")
def _():
    rng = random.Random(11)

    def skew(n):
        a = [[F(0)] * n for _ in range(n)]
        for i in range(n):
            for j in range(i + 1, n):
                a[i][j] = F(rng.randint(-9, 9))
                a[j][i] = -a[i][j]
        return a

    odd = [det(skew(5)) for _ in range(20)]
    even = [det(skew(4)) for _ in range(20)]
    assert all(d >= 0 and math.isqrt(int(d)) ** 2 == d for d in even) and any(d > 0 for d in even)
    return "a" if all(d == 0 for d in odd) else "d"


@check("lac-det-002")
def _():
    return det([[3 if i == j else 1 for j in range(5)] for i in range(5)])


@check("lac-det-003")
def _():
    n = 10
    t = [[2 if i == j else (-1 if abs(i - j) == 1 else 0) for j in range(n)] for i in range(n)]
    assert det([[2, -1], [-1, 2]]) == 3
    return det(t)


@check("lac-det-004")
def _():
    m = [[min(i, j) for j in range(1, 6)] for i in range(1, 6)]
    # follow-up: min(t_i, t_j) has determinant t1 (t2 - t1) ... (tn - t(n-1))
    ts = [F(1, 2), F(1), F(3), F(7, 2)]
    mt = [[min(a, b) for b in ts] for a in ts]
    gaps = [ts[0]] + [b - a for a, b in zip(ts, ts[1:])]
    assert det(mt) == math.prod(gaps)
    return det(m)


@check("lac-det-005")
def _():
    rng = random.Random(15)
    for _ in range(10):
        a, b = rand_int_matrix(rng, 3, 3), rand_int_matrix(rng, 3, 3)
        assert det(matmul(a, b)) == det(a) * det(b)
    # area of the image of the unit square (shoelace) is |det|
    for _ in range(10):
        a = rand_int_matrix(rng, 2, 2)
        pts = [matvec(a, p) for p in ([F(0), F(0)], [F(1), F(0)], [F(1), F(1)], [F(0), F(1)])]
        area = sum(pts[i][0] * pts[(i + 1) % 4][1] - pts[(i + 1) % 4][0] * pts[i][1] for i in range(4)) / 2
        assert abs(area) == abs(det(a)) and area == det(a)  # signed area keeps the orientation
    assert det([[1, 0], [0, -1]]) == -1


# ---------------------------------------------------------------- eigenvalues and eigenvectors


@check("lac-eigen-001")
def _():
    estimates = []
    for a in range(-3, 10):
        m = [[a, 1], [a * (7 - a) - 10, 7 - a]]
        assert trace(mat(m)) == 7 and det(m) == 10
        lam, _v = power_iteration(m, iters=400)
        estimates.append(lam)
    assert max(estimates) - min(estimates) < 1e-9
    return estimates[0]


@check("lac-eigen-002")
def _():
    u, v = [1, 2, 3], [4, -1, 2]
    a = mat([[x * y for y in v] for x in u])
    c = charpoly(a)
    assert c[2] == 0 and c[3] == 0  # λ³ + c1 λ²: one non-zero root
    return -c[1]


@check("lac-eigen-003")
def _():
    a = mat([[2, 1], [1, 2]])
    p = identity(2)
    for _ in range(10):
        p = matmul(p, a)
    return p[0][1]


@check("lac-eigen-004")
def _():
    p = mat([[F(9, 10), F(1, 10)], [F(3, 10), F(7, 10)]])
    c = charpoly(p)
    assert poly_eval(c, F(1)) == 0 and poly_eval(c, F(3, 5)) == 0
    pi = [F(3, 4), F(1, 4)]
    assert [sum(pi[i] * p[i][j] for i in range(2)) for j in range(2)] == pi
    # P^n(1,1) - 3/4 = (1/4)(3/5)^n, first below 0.01 at n = 7
    pn, first = identity(2), None
    for n in range(1, 20):
        pn = matmul(pn, p)
        assert pn[0][0] - F(3, 4) == F(1, 4) * F(3, 5) ** n
        if first is None and pn[0][0] - F(3, 4) < F(1, 100):
            first = n
    assert first == 7
    # no eigenvalue of a stochastic matrix exceeds 1 in modulus
    rng = random.Random(14)
    for _ in range(20):
        rows = [[F(rng.randint(0, 9)) for _ in range(4)] for _ in range(4)]
        rows = [[x / sum(r) for x in r] if sum(r) else [F(1, 4)] * 4 for r in rows]
        assert max(abs(z) for z in poly_roots(charpoly(rows))) <= 1 + 1e-7


@check("lac-eigen-005")
def _():
    rng = random.Random(15)
    n = 4

    def d(u, v):
        return det(add(identity(n), mat([[x * y for y in v] for x in u]), -1))

    for _ in range(10):
        u = [F(rng.randint(-5, 5)) for _ in range(n)]
        v = [F(rng.randint(-5, 5)) for _ in range(n)]
        assert d(u, v) == 1 - dot(v, u)
    u = [F(1), F(2), F(0), F(-1)]
    v_one = [F(1), F(0), F(0), F(0)]  # vᵀu = 1, not parallel to u
    v_orth = [F(2), F(-1), F(5), F(0)]  # vᵀu = 0
    v_par = [2 * x / dot(u, u) for x in u]  # parallel, vᵀu = 2
    picks = {"a": d(u, v_one) == 0, "b": d(u, v_orth) == 0, "c": d(u, v_par) == 0}
    assert picks == {"a": True, "b": False, "c": False}
    return "a"


@check("lac-eigen-006")
def _():
    rng = random.Random(16)
    truth = {"a": True, "b": True, "c": True}
    for _ in range(10):
        s = rand_int_matrix(rng, 3, 3)
        s = add(s, transpose(s))
        roots = poly_roots(charpoly(s))
        truth["a"] &= all(abs(z.imag) < 1e-6 for z in roots)
        lams = sorted(z.real for z in roots)
        if min(b - a for a, b in zip(lams, lams[1:])) < 1e-3:
            continue
        vecs = []
        for lam in lams:  # null vector of S - λI: cross product of two of its rows
            r = [[float(s[i][j]) - (lam if i == j else 0) for j in range(3)] for i in range(3)]
            cands = [
                [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]]
                for p, q in ((r[0], r[1]), (r[0], r[2]), (r[1], r[2]))
            ]
            w = max(cands, key=lambda c: sum(t * t for t in c))
            nrm = math.sqrt(sum(t * t for t in w))
            vecs.append([t / nrm for t in w])
        for i in range(3):
            for j in range(i + 1, 3):
                truth["b"] &= abs(sum(x * y for x, y in zip(vecs[i], vecs[j]))) < 1e-8
        rebuilt = [[sum(lams[k] * vecs[k][i] * vecs[k][j] for k in range(3)) for j in range(3)] for i in range(3)]
        truth["c"] &= all(abs(rebuilt[i][j] - float(s[i][j])) < 1e-8 for i in range(3) for j in range(3))
    truth["d"] = det(mat([[0, 0], [0, 0]])) != 0
    roots = sorted(z.real for z in poly_roots(charpoly(mat([[1, 2], [2, 1]]))))
    truth["e"] = roots[0] > 0
    truth["f"] = abs(roots[0] - 1) < 1e-9 and abs(roots[1] - 1) < 1e-9
    assert abs(roots[0] + 1) < 1e-9 and abs(roots[1] - 3) < 1e-9
    return {k for k, v in truth.items() if v}


@check("lac-eigen-007")
def _():
    mats = {
        "A": mat([[1, 1], [0, 1]]),
        "B": mat([[1, 1], [0, 2]]),
        "C": mat([[0, -1], [1, 0]]),
        "D": mat([[2, 0], [0, 2]]),
    }
    defective = set()
    for name, m in mats.items():
        roots = poly_roots(charpoly(m))
        # group the eigenvalues; a repeated one needs a 2-dimensional eigenspace
        if abs(roots[0] - roots[1]) < 1e-6:
            lam = F(round(roots[0].real))
            assert poly_eval(charpoly(m), lam) == 0
            if len(null_space(add(m, scale(identity(2), lam), -1))) < 2:
                defective.add(name)
    assert defective == {"A"}
    return "a"


@check("lac-eigen-008")
def _():
    rng = random.Random(18)
    for _ in range(5):
        a, b = rand_int_matrix(rng, 3, 5), rand_int_matrix(rng, 5, 3)
        ab, ba = matmul(a, b), matmul(b, a)
        assert charpoly(ba) == charpoly(ab) + [F(0), F(0)]  # λ² p_AB(λ) = p_BA(λ)
        assert trace(ab) == trace(ba)
    a, b = mat([[0, 1], [0, 0]]), mat([[1, 0], [0, 0]])
    assert matmul(a, b) == mat([[0, 0], [0, 0]]) and matmul(b, a) != mat([[0, 0], [0, 0]])


# ---------------------------------------------------------------- PSD and covariance matrices


@check("lac-psd-001")
def _():
    t = F(9, 10)
    mats = {
        "a": mat([[4, 3], [3, 2]]),
        "b": mat([[1, 2], [2, 4]]),
        "c": mat([[2, -1, 0], [-1, 2, -1], [0, -1, 2]]),
        "d": mat([[1, t, 0], [t, 1, t], [0, t, 1]]),
        "e": mat([[1, 2], [0, 1]]),
    }
    valid = {k for k, m in mats.items() if is_psd_exact(m)}
    for k in valid:  # second opinion from the eigenvalues
        assert min(jacobi_eigen(mats[k])[0]) > -1e-12
    for k in ("a", "d"):
        assert min(jacobi_eigen(mats[k])[0]) < 0
    return valid


@check("lac-psd-002")
def _():
    rng = random.Random(22)
    for _ in range(20):
        x = rand_int_matrix(rng, 4, 3)
        w = [F(rng.randint(-5, 5)) for _ in range(3)]
        xw = matvec(x, w)
        q = dot(w, matvec(matmul(transpose(x), x), w))
        assert q == dot(xw, xw) and q >= 0
    m = mat([[0, 0], [0, -1]])  # leading minors 0 and 0, yet not PSD
    assert m[0][0] >= 0 and det(m) >= 0 and not principal_minors_nonneg(m)


@check("lac-psd-003")
def _():
    rng = random.Random(23)
    days = 10
    r1 = [F(rng.randint(-50, 50), 1000) for _ in range(days)]
    r2 = [F(rng.randint(-50, 50), 1000) for _ in range(days)]
    rets = [r1, r2, [a + b for a, b in zip(r1, r2)]]
    means = [sum(r) / days for r in rets]
    cov = [[sum((a - mi) * (b - mj) for a, b in zip(ri, rj)) / (days - 1) for rj, mj in zip(rets, means)] for ri, mi in zip(rets, means)]
    assert matvec(cov, [F(1), F(1), F(-1)]) == [0, 0, 0]
    # fewer observations than assets: rank at most T - 1
    data = rand_int_matrix(rng, 4, 6)
    col_means = [sum(c) / 4 for c in zip(*data)]
    xc = [[x - m for x, m in zip(r, col_means)] for r in data]
    assert rank(matmul(transpose(xc), xc)) <= 3


@check("lac-psd-004")
def _():
    rho = 0.6
    rng = random.Random(24)
    n = 100_000
    xs, ys = [], []
    for _ in range(n):
        z1, z2 = rng.gauss(0, 1), rng.gauss(0, 1)
        xs.append(z1)
        ys.append(rho * z1 + math.sqrt(1 - rho * rho) * z2)
    mx, my = sum(xs) / n, sum(ys) / n
    sxy = sum((a - mx) * (b - my) for a, b in zip(xs, ys))
    sxx = sum((a - mx) ** 2 for a in xs)
    syy = sum((b - my) ** 2 for b in ys)
    assert abs(sxy / math.sqrt(sxx * syy) - rho) < 0.01
    # the 2x2 Cholesky factor, and where the algorithm breaks down
    l21, l22sq = rho, 1 - rho * rho
    assert abs(l21 * l21 + l22sq - 1) < 1e-15
    assert 1 - 1**2 == 0  # [[1,1],[1,1]]: zero pivot
    assert 1 - 2**2 < 0  # [[1,2],[2,1]]: negative under the square root
    assert abs(math.sqrt(0.3) ** 2 - 0.3) < 1e-15  # one-factor construction gives correlation 0.3


@check("lac-psd-005")
def _():
    sigma = mat([[4, 2, 2], [2, 5, 3], [2, 3, 6]])
    l33_sq = det(sigma) / det([r[:2] for r in sigma[:2]])  # Schur complement: Var(X3 | X1, X2)
    root = math.isqrt(int(l33_sq))
    assert l33_sq.denominator == 1 and root * root == l33_sq
    # second opinion: a floating Cholesky
    s = [[float(x) for x in r] for r in sigma]
    low = [[0.0] * 3 for _ in range(3)]
    for i in range(3):
        for j in range(i + 1):
            acc = s[i][j] - sum(low[i][k] * low[j][k] for k in range(j))
            low[i][j] = math.sqrt(acc) if i == j else acc / low[j][j]
    assert abs(low[2][2] - root) < 1e-12
    return root


@check("lac-psd-006")
def _():
    ones = [[1.0] * 10 for _ in range(10)]
    lam, _v = power_iteration(ones, iters=50)
    rng = random.Random(26)
    for _ in range(10):  # random correlation matrices never exceed the trace
        data = [[rng.gauss(0, 1) + (rng.random() < 0.5) * rng.gauss(0, 1) for _ in range(10)] for _ in range(30)]
        means = [sum(c) / 30 for c in zip(*data)]
        xc = [[x - m for x, m in zip(r, means)] for r in data]
        cov = [[sum(r[i] * r[j] for r in xc) for j in range(10)] for i in range(10)]
        corr = [[cov[i][j] / math.sqrt(cov[i][i] * cov[j][j]) for j in range(10)] for i in range(10)]
        assert max(jacobi_eigen(corr)[0]) <= 10 + 1e-9
    return lam


@check("lac-psd-007")
def _():
    a, b = mat([[2, 1], [1, 1]]), mat([[1, 0], [0, 0]])
    assert is_psd_exact(a) and is_psd_exact(b) and matmul(a, b) == mat([[2, 0], [1, 0]])
    rng = random.Random(27)
    always = True
    for _ in range(10):
        g, h = rand_int_matrix(rng, 3, 3), rand_int_matrix(rng, 3, 3)
        a, b = matmul(g, transpose(g)), matmul(h, transpose(h))
        ab = matmul(a, b)
        always &= ab == transpose(ab)
        c = add(matmul(a, a), scale(a, 2))  # commutes with a
        ac = matmul(a, c)
        assert ac == matmul(c, a) and is_psd_exact(ac)
        hadamard = [[x * y for x, y in zip(r, q)] for r, q in zip(a, b)]
        assert is_psd_exact(hadamard)
    assert not always
    return "b"


@check("lac-psd-008")
def _():
    t = F(9, 10)
    c = mat([[1, t, 0], [t, 1, t], [0, t, 1]])
    lam_min = min(z.real for z in poly_roots(charpoly(c)))
    assert abs(lam_min - (1 - 0.9 * math.sqrt(2))) < 1e-12
    delta = -lam_min / (1 - lam_min)
    shrunk = [[(1 - delta) * float(c[i][j]) + delta * (i == j) for j in range(3)] for i in range(3)]
    assert abs(min(jacobi_eigen(shrunk)[0])) < 1e-12
    # follow-up: smallest eigenvalue -0.1 needs δ = 1/11
    d = F(1, 11)
    assert (1 - d) * F(-1, 10) + d == 0
    # eigenvalue clipping then rescaling gives a valid correlation matrix
    vals, vecs = jacobi_eigen(c)
    vals = [max(v, 0.0) for v in vals]
    rebuilt = [[sum(vals[k] * vecs[i][k] * vecs[j][k] for k in range(3)) for j in range(3)] for i in range(3)]
    fixed = [[rebuilt[i][j] / math.sqrt(rebuilt[i][i] * rebuilt[j][j]) for j in range(3)] for i in range(3)]
    assert all(abs(fixed[i][i] - 1) < 1e-12 for i in range(3))
    assert min(jacobi_eigen(fixed)[0]) > -1e-12


# ---------------------------------------------------------------- projections and least squares


@check("lac-ls-001")
def _():
    basis = transpose(mat([[1, -1, 0], [0, 1, -1]]))  # columns span x + y + z = 0
    b = [F(1), F(2), F(6)]
    coef = solve(matmul(transpose(basis), basis), matvec(transpose(basis), b))
    p = matvec(basis, coef)
    assert sum(p) == 0 and dot([x - y for x, y in zip(b, p)], basis_col(basis, 0)) == 0
    return dot(p, p)


def basis_col(m, j):
    return [r[j] for r in m]


def hat(x):
    xt = transpose(x)
    g = matmul(xt, x)
    ginv = [solve(g, e) for e in identity(len(g))]  # columns of the inverse (g symmetric)
    return matmul(matmul(x, transpose(ginv)), xt)


@check("lac-ls-002")
def _():
    rng = random.Random(32)
    truth = {k: True for k in "abcdef"}
    truth["d"] = truth["e"] = False
    examples = [mat([[1, 0], [1, 1], [1, 2]])] + [rand_int_matrix(rng, 6, 3) for _ in range(5)]
    for x in examples:
        if rank(x) < len(x[0]):
            continue
        h = hat(x)
        n, p = len(x), len(x[0])
        truth["a"] &= h == transpose(h) and matmul(h, h) == h
        # det(λI - H) = λ^(n-p) (λ - 1)^p, compared coefficient by coefficient
        target = [F(1)]
        for root in [F(0)] * (n - p) + [F(1)] * p:
            target = [a - root * b for a, b in zip(target + [F(0)], [F(0)] + target)]
        truth["b"] &= charpoly(h) == target
        truth["c"] &= trace(h) == p
        truth["d"] |= det(h) != 0
        truth["e"] |= all(0 <= v <= 1 for r in h for v in r)
        y = [F(rng.randint(-9, 9)) for _ in range(n)]
        e = [a - b for a, b in zip(y, matvec(h, y))]
        truth["f"] &= matvec(transpose(x), e) == [0] * p
    assert hat(examples[0])[0][2] == F(-1, 6)
    return {k for k, v in truth.items() if v}


@check("lac-ls-003")
def _():
    rng = random.Random(33)
    x = rand_int_matrix(rng, 6, 3)
    y = [F(rng.randint(-9, 9)) for _ in range(6)]
    beta = solve(matmul(transpose(x), x), matvec(transpose(x), y))
    e = [a - b for a, b in zip(y, matvec(x, beta))]
    assert matvec(transpose(x), e) == [0, 0, 0]
    rss = dot(e, e)
    for _ in range(20):
        other = [b + F(rng.randint(-3, 3), 7) for b in beta]
        r = [a - b for a, b in zip(y, matvec(x, other))]
        assert dot(r, r) >= rss


@check("lac-ls-004")
def _():
    rho = 0.95
    m = [[1.0, rho], [rho, 1.0]]
    big, _v = power_iteration(m, iters=200)
    small = 2.0 - big  # the trace is 2
    assert abs(math.sqrt(big / small) - math.sqrt(39)) < 1e-9  # condition number of X itself
    assert abs(1 / (1 - rho * rho) - 10.256) < 1e-3  # the variance inflation factor, a distractor
    return big / small


@check("lac-ls-005")
def _():
    d = 1e-9
    assert 1.0 + d * d == 1.0  # δ² is lost next to 1
    xtx = [[1.0 + d * d, 1.0], [1.0, 1.0 + d * d]]
    assert xtx[0][0] * xtx[1][1] - xtx[0][1] * xtx[1][0] == 0.0
    # κ(XᵀX) = κ(X)²: κ(X) from max/min of |Xv| over unit v, κ(XᵀX) from its eigenvalues
    rng = random.Random(35)
    x = [[rng.uniform(-1, 1), rng.uniform(-1, 1)] for _ in range(5)]
    x = [[a, a + 0.05 * b] for a, b in x]  # nearly collinear columns

    def stretch(t):
        return math.sqrt(sum((r[0] * math.cos(t) + r[1] * math.sin(t)) ** 2 for r in x))

    t_max = golden_min(lambda t: -stretch(t), 0, math.pi / 2)
    t_min = golden_min(stretch, math.pi / 2, math.pi)
    kappa_x = stretch(t_max) / stretch(t_min)
    g = [[sum(r[i] * r[j] for r in x) for j in range(2)] for i in range(2)]
    vals = jacobi_eigen(g)[0]
    assert abs(max(vals) / min(vals) / kappa_x**2 - 1) < 1e-6


@check("lac-ls-006")
def _():
    def slopes(xs, ys):
        n = len(xs)
        mx, my = sum(xs) / n, sum(ys) / n
        sxy = sum((a - mx) * (b - my) for a, b in zip(xs, ys))
        return sxy / sum((a - mx) ** 2 for a in xs), sxy / sum((b - my) ** 2 for b in ys)

    # choice b is realised by an explicit data set
    xs = [F(v) for v in (-1, 1, -1, 1)]
    noise = [F(v) for v in (1, 1, -1, -1)]
    ys = [2 * a + e for a, e in zip(xs, noise)]
    assert slopes(xs, ys) == (2, F(2, 5))
    # every data set has 0 <= ac <= 1 with a, c of the same sign
    rng = random.Random(36)
    for _ in range(500):
        xs = [F(rng.randint(-9, 9)) for _ in range(6)]
        ys = [F(rng.randint(-9, 9)) for _ in range(6)]
        if len(set(xs)) < 2 or len(set(ys)) < 2:
            continue
        a, c = slopes(xs, ys)
        assert 0 <= a * c <= 1 and a * c >= 0
    choices = {"a": (2, F(3, 5)), "b": (2, F(2, 5)), "c": (-1, F(1, 2)), "d": (F(1, 2), 3)}
    possible = [k for k, (a, c) in choices.items() if 0 <= a * c <= 1 and (a > 0) == (c > 0)]
    assert possible == ["b"]
    return "b"


# ---------------------------------------------------------------- SVD, PCA and conditioning


@check("lac-svd-001")
def _():
    c = [[1.0 if i == j else 0.3 for j in range(5)] for i in range(5)]
    vals = jacobi_eigen(c)[0]
    return max(vals) / sum(vals)


def rotation(n, rng):
    """A random orthogonal matrix as a product of Givens rotations."""
    q = [[float(i == j) for j in range(n)] for i in range(n)]
    for i in range(n):
        for j in range(i + 1, n):
            t = rng.uniform(0, 2 * math.pi)
            c, s = math.cos(t), math.sin(t)
            for k in range(n):
                a, b = q[k][i], q[k][j]
                q[k][i], q[k][j] = c * a - s * b, s * a + c * b
    return q


@check("lac-svd-002")
def _():
    rng = random.Random(42)
    n = 8
    betas = [rng.uniform(0.5, 1.5) for _ in range(n)]
    cov = [[0.04 * betas[i] * betas[j] + (0.01 * rng.uniform(0.5, 2) if i == j else 0) for j in range(n)] for i in range(n)]
    cov = [[(cov[i][j] + cov[j][i]) / 2 for j in range(n)] for i in range(n)]
    vals, vecs = jacobi_eigen(cov)
    top = max(range(n), key=lambda k: vals[k])
    v = [vecs[i][top] for i in range(n)]
    assert all(x > 0 for x in v) or all(x < 0 for x in v)  # the market factor: one sign
    second = sorted(vals)[-2]
    assert vals[top] > 5 * second


@check("lac-svd-003")
def _():
    rng = random.Random(43)
    u, w = rotation(3, rng), rotation(3, rng)
    s = [5.0, 3.0, 1.0]
    a = [[sum(u[i][k] * s[k] * w[j][k] for k in range(3)) for j in range(3)] for i in range(3)]
    # best rank-one fit by alternating least squares, from a random start
    y = [rng.uniform(-1, 1) for _ in range(3)]
    for _ in range(500):
        x = [sum(a[i][j] * y[j] for j in range(3)) / sum(t * t for t in y) for i in range(3)]
        y = [sum(a[i][j] * x[i] for i in range(3)) / sum(t * t for t in x) for j in range(3)]
    return math.sqrt(sum((a[i][j] - x[i] * y[j]) ** 2 for i in range(3) for j in range(3)))


@check("lac-svd-004")
def _():
    a = [[3.0, 0.0], [4.0, 5.0]]

    def stretch(t):
        x = (math.cos(t), math.sin(t))
        return math.hypot(a[0][0] * x[0] + a[0][1] * x[1], a[1][0] * x[0] + a[1][1] * x[1])

    grid = [k * math.pi / 2000 for k in range(2000)]
    t_hi = max(grid, key=stretch)
    t_lo = min(grid, key=stretch)
    t_hi = golden_min(lambda t: -stretch(t), t_hi - 0.01, t_hi + 0.01)
    t_lo = golden_min(stretch, t_lo - 0.01, t_lo + 0.01)
    big, small = stretch(t_hi), stretch(t_lo)
    assert abs(big * small - 15) < 1e-9  # σ1 σ2 = |det A|
    return big / small


@check("lac-svd-005")
def _():
    # a 2x2 system with condition number about 3e10, solved in floating point with pivoting
    d = 2.0**-33
    a = [[1.0, 1.0], [1.0, 1.0 + d]]
    ex = mat(a)
    rng = random.Random(45)
    worst = 0.0
    for _ in range(50):
        x_true = [F(rng.randint(1, 99), rng.randint(1, 99)) for _ in range(2)]
        b = [float(v) for v in matvec(ex, x_true)]
        f = a[1][0] / a[0][0]
        x2 = (b[1] - f * b[0]) / (a[1][1] - f * a[0][1])
        x1 = (b[0] - a[0][1] * x2) / a[0][0]
        err = max(abs(x1 - float(x_true[0])), abs(x2 - float(x_true[1]))) / max(abs(float(t)) for t in x_true)
        worst = max(worst, err)
    assert 1e-10 < worst < 1e-4  # roughly 16 - 10 digits survive, not 16 and not 0
    return "b"


@check("lac-svd-006")
def _():
    assert 500 * 501 // 2 == 125_250
    assert 500 + 500 + 1 == 1001
    rng = random.Random(46)
    data = rand_int_matrix(rng, 6, 10)
    means = [sum(c) / 6 for c in zip(*data)]
    xc = [[x - m for x, m in zip(r, means)] for r in data]
    assert rank(matmul(transpose(xc), xc)) == 5  # T - 1 with T = 6 days, N = 10 stocks


@check("lac-svd-007")
def _():
    def singular_values(m):
        g = [[float(v) for v in r] for r in matmul(transpose(mat(m)), mat(m))]
        return sorted(math.sqrt(max(v, 0.0)) for v in jacobi_eigen(g)[0])

    def abs_eigs(m):
        return sorted(abs(z) for z in poly_roots(charpoly(mat(m))))

    truth = {"a": True}
    jordan = [[1, 1], [0, 1]]
    truth["b"] = all(abs(s - e) < 1e-9 for s, e in zip(singular_values(jordan), abs_eigs(jordan)))
    assert abs(singular_values(jordan)[1] - (math.sqrt(5) + 1) / 2) < 1e-12
    sym = [[1, 2], [2, 1]]
    truth["c"] = all(abs(s - e) < 1e-9 for s, e in zip(singular_values(sym), abs_eigs(sym)))
    low = [[1, 2], [2, 4]]
    truth["d"] = sum(s > 1e-9 for s in singular_values(low)) == rank(low)
    a = [[3, 0], [4, 5]]
    best = max(math.hypot(3 * math.cos(t), 4 * math.cos(t) + 5 * math.sin(t)) for t in (k * math.pi / 20000 for k in range(20000)))
    truth["e"] = abs(best - singular_values(a)[1]) < 1e-6
    # f: a rotation has AᵀA = I, so U = AV; U = V would force A = I
    rot = mat([[0, -1], [1, 0]])
    assert matmul(transpose(rot), rot) == identity(2)
    truth["f"] = rot == identity(2)
    return {k for k, v in truth.items() if v}


# ---------------------------------------------------------------- limits, derivatives, approximations


@check("lac-limits-001")
def _():
    n = 10**8
    value = math.exp(3 * n * math.log1p(-2 / n))
    choices = {"a": 1.0, "b": math.exp(-6), "c": math.exp(-2 / 3), "d": 0.0}
    return min(choices, key=lambda k: abs(choices[k] - value))


@check("lac-limits-002")
def _():
    def f(x):
        return math.exp(math.log(x) * math.log(math.log(x)))

    return richardson_derivative(f, math.exp(math.e), 1e-3)


@check("lac-limits-003")
def _():
    # f^(k) = P_k(x) e^(x²) with P_(k+1) = P_k' + 2x P_k; coefficients low degree first
    p = [0, 1]  # P_0 = x
    for _ in range(7):
        deriv = [i * c for i, c in enumerate(p)][1:]
        shifted = [0] + [2 * c for c in p]
        size = max(len(deriv), len(shifted))
        p = [(deriv[i] if i < len(deriv) else 0) + (shifted[i] if i < len(shifted) else 0) for i in range(size)]
    return p[0]


@check("lac-limits-004")
def _():
    def g(x):
        return simpson(lambda t: Phi(t + x), math.log(x), x * x, 400)

    d = richardson_derivative(g, 1.0, 1e-3)
    assert abs(d - (2 * Phi(2) - Phi(1))) > 0.1  # the boundary terms alone are not enough
    return d


@check("lac-limits-005")
def _():
    def tower(x, n=20000):
        a = x
        for _ in range(n):
            if a > 50:
                return math.inf
            a = x**a
        return a

    assert abs(tower(math.sqrt(2)) - 2) < 1e-9
    top = math.exp(1 / math.e)
    limits = [tower(1 + k * (top - 1) / 400) for k in range(1, 401)]
    assert max(limits) <= math.e + 1e-3  # the largest reachable value is e
    assert tower(top + 0.01) == math.inf
    return "b"


@check("lac-limits-006")
def _():
    assert abs(1.1 * 0.9 - 0.99) < 1e-15
    assert abs(math.log(1.2) - 0.1823) < 1e-4
    rng = random.Random(56)
    mu, sigma, n = 0.0005, 0.02, 200_000
    mean_log = math.fsum(math.log1p(rng.gauss(mu, sigma)) for _ in range(n)) / n
    assert abs(mean_log - (mu - sigma**2 / 2)) < 4 * sigma / math.sqrt(n) + 1e-5
    lev = [L / 10 for L in range(0, 30)]
    growth = [L * mu - L * L * sigma**2 / 2 for L in lev]
    assert abs(lev[growth.index(max(growth))] - mu / sigma**2) <= 0.05 + 1e-12


# ---------------------------------------------------------------- integrals


@check("lac-integrals-001")
def _():
    return simpson(lambda x: x**5 * math.exp(-x), 0.0, 80.0, 40000)


@check("lac-integrals-002")
def _():
    return simpson_graded(math.log, 0.0, 1.0)


@check("lac-integrals-003")
def _():
    assert abs(simpson(lambda x: math.exp(-x * x), -10, 10, 4000) - math.sqrt(math.pi)) < 1e-12
    assert abs(simpson(lambda x: math.exp(-x * x / 2), -14, 14, 4000) - math.sqrt(2 * math.pi)) < 1e-12
    a, b = 2.0, 1.5
    lhs = simpson(lambda x: math.exp(-a * x * x + b * x), -12, 12, 4000)
    assert abs(lhs - math.sqrt(math.pi / a) * math.exp(b * b / (4 * a))) < 1e-10


@check("lac-integrals-004")
def _():
    return simpson(lambda x: x * x * math.exp(-x * x), 0.0, 12.0, 4000)


@check("lac-integrals-005")
def _():
    return simpson(lambda x: 1 / math.cos(x), 0.0, math.pi / 6, 2000)


@check("lac-integrals-006")
def _():
    def trial(rng):
        x, y, z = rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1)
        return 8.0 if y * y + z * z <= 1 and x * x + z * z <= 1 else 0.0

    return simulate(trial)


@check("lac-integrals-007")
def _():
    def f(x):
        if x <= 0:
            return 0.0
        if x >= 1:
            return 1.0
        return (x - 1) / math.log(x)

    return simpson_graded(f, 0.0, 0.5) + simpson(f, 0.5, 1.0, 2000)


# ---------------------------------------------------------------- series and sums


@check("lac-series-001")
def _():
    return float(sum(F(n, 2**n) for n in range(1, 201)))


@check("lac-series-002")
def _():
    return sum(F(1, n * (n + 1)) for n in range(1, 100))


@check("lac-series-003")
def _():
    n = 10**6
    return math.fsum(1 / k for k in range(n + 1, 2 * n + 1))


@check("lac-series-004")
def _():
    converges = set()
    # a: partial sums exceed ln ln(N+1) - ln ln 2, which is unbounded
    s = 0.0
    for n in range(2, 100_001):
        s += 1 / (n * math.log(n))
        if n in (10, 1000, 100_000):
            assert s >= math.log(math.log(n + 1)) - math.log(math.log(2))
    # b: alternating partial sums settle (to ln 2) within the next term
    s = 0.0
    for n in range(1, 10_001):
        s += (-1) ** (n + 1) / n
    assert abs(s - math.log(2)) < 1 / 10_001
    converges.add("b")
    # c: n^(1/n) < 2 always (largest at n = 3), so the terms exceed 1/(2n)
    assert max(n ** (1 / n) for n in range(1, 1_000_001)) == 3 ** (1 / 3) < 2
    # d: the ratio (n/(n+1))^n never exceeds 1/2, so the terms are dominated by a geometric series
    assert all((n / (n + 1)) ** n <= 0.5 + 1e-15 for n in range(1, 100_001))
    converges.add("d")
    # e: sin(1/n) >= (2/π)(1/n), a multiple of the harmonic series
    assert all(math.sin(1 / n) >= 2 / math.pi / n for n in range(1, 100_001))
    # f: (ln n)^(ln n) = n^(ln ln n) >= n² once n >= e^(e²) ≈ 1618.2
    assert math.log(math.log(1619)) >= 2 > math.log(math.log(1618))
    for n in range(1619, 1_000_000, 997):
        assert math.log(n) * math.log(math.log(n)) >= 2 * math.log(n)
    converges.add("f")
    return converges


@check("lac-series-005")
def _():
    m = 100_000
    partial = math.fsum(1 / (2 * k + 1) ** 2 for k in range(m))
    # tail: sum over k >= m of 1/(2k+1)² lies between 1/(4m+2) and 1/(4m - 2)
    tail_lo, tail_hi = 1 / (4 * m + 2), 1 / (4 * m - 2)
    assert tail_hi - tail_lo < 1e-9
    return partial + (tail_lo + tail_hi) / 2


@check("lac-series-006")
def _():
    h1000 = float(sum(F(1, k) for k in range(1, 1001)))
    assert abs(h1000 - 7.4855) < 1e-4
    assert math.log(1001) <= h1000 <= 1 + math.log(1000)
    assert abs(h1000 - math.log(1000) - 0.5772) < 0.001
    # H_n ≈ ln n + γ + 1/(2n), checked against direct sums, puts the crossing of 20 near e^19.42
    gamma = 0.5772156649015329
    s = 0.0
    for n in range(1, 1_000_001):
        s += 1 / n
        if n in (10, 1000, 1_000_000):
            assert abs(s - (math.log(n) + gamma + 1 / (2 * n))) < 1 / (12 * n * n) + 1e-12
    crossing = math.exp(20 - gamma)
    assert 2e8 < crossing < 3e8


@check("lac-series-007")
def _():
    total, h = 0.0, 0.0
    for n in range(1, 201):
        h += 1 / n
        total += h / 2**n
    return total


# ---------------------------------------------------------------- optimisation, convexity, inequalities


@check("lac-optim-001")
def _():
    assert abs(math.exp(math.pi) - 23.1407) < 1e-4 and abs(math.pi**math.e - 22.4592) < 1e-4
    # the general claim: for e <= a < b, a^b > b^a
    for i in range(1, 50):
        for j in range(i + 1, 51):
            a, b = math.e + i / 10, math.e + j / 10
            assert b * math.log(a) > a * math.log(b)
    return "a" if math.exp(math.pi) > math.pi**math.e else "b"


@check("lac-optim-002")
def _():
    def var(w):
        return w * w * 0.04 + (1 - w) ** 2 * 0.09

    w = golden_min(var, 0.0, 1.0)
    assert abs(math.sqrt(var(w)) - 0.06 / math.sqrt(0.13)) < 1e-9
    return w


@check("lac-optim-003")
def _():
    rng = random.Random(63)
    g = rand_int_matrix(rng, 3, 3)
    sigma = add(matmul(g, transpose(g)), identity(3))  # positive definite
    ones = [F(1)] * 3
    x = solve(sigma, ones)
    w = [t / sum(x) for t in x]
    var = dot(w, matvec(sigma, w))
    assert sum(w) == 1 and var == 1 / dot(ones, x)
    for _ in range(30):  # moving along the constraint never lowers the variance
        d = [F(rng.randint(-5, 5), 13) for _ in range(2)]
        d.append(-d[0] - d[1])
        w2 = [a + b for a, b in zip(w, d)]
        assert dot(w2, matvec(sigma, w2)) >= var
    # follow-up: σ = 10%, 20%, ρ = 0.9 shorts the second asset
    s1, s2, rho = F(1, 10), F(2, 10), F(9, 10)
    cov = [[s1 * s1, rho * s1 * s2], [rho * s1 * s2, s2 * s2]]
    x = solve(cov, [F(1), F(1)])
    assert x[0] / sum(x) == F(11, 7)


@check("lac-optim-004")
def _():
    # x = (12 - 3y - 4z)/2 on the plane; minimise the squared distance over (y, z) exactly
    # d²(y, z) = ((12 - 3y - 4z)/2)² + y² + z²; its gradient is linear in (y, z)
    def grad_coeffs():
        def q(y, z):
            return ((12 - 3 * y - 4 * z) / F(2)) ** 2 + y * y + z * z

        h = F(1)
        # q is quadratic: recover its Hessian and gradient at 0 by finite differences (exact)
        q0 = q(F(0), F(0))
        qy, qz = q(h, F(0)), q(F(0), h)
        qyy = q(2 * h, F(0)) - 2 * qy + q0
        qzz = q(F(0), 2 * h) - 2 * qz + q0
        qyz = q(h, h) - qy - qz + q0
        gy = qy - q0 - qyy / 2
        gz = qz - q0 - qzz / 2
        return q, [[qyy, qyz], [qyz, qzz]], [gy, gz]

    q, hess, g = grad_coeffs()
    yz = solve(hess, [-g[0], -g[1]])
    best = q(*yz)
    for dy, dz in itertools.product((F(-1, 9), F(0), F(1, 9)), repeat=2):
        assert q(yz[0] + dy, yz[1] + dz) >= best
    return math.sqrt(best)


@check("lac-optim-005")
def _():
    rng = random.Random(65)
    truth = {}
    ok = True
    for _ in range(200):
        xs = [rng.uniform(0.01, 10) for _ in range(rng.randint(2, 6))]
        ok &= math.prod(xs) ** (1 / len(xs)) <= sum(xs) / len(xs) + 1e-12
    truth["a"] = ok

    convex = [lambda x: x * x, abs, math.exp, lambda x: max(x, 0.0), lambda x: x**4, lambda x: -x]

    def midpoint_ok(h, trials=300):
        for _ in range(trials):
            a, b = rng.uniform(-3, 3), rng.uniform(-3, 3)
            if h((a + b) / 2) > (h(a) + h(b)) / 2 + 1e-9:
                return False
        return True

    truth["b"] = all(midpoint_ok(lambda x, f=f, g=g: f(x) + g(x)) for f in convex for g in convex)
    truth["d"] = all(midpoint_ok(lambda x, f=f, g=g: max(f(x), g(x))) for f in convex for g in convex)
    truth["c"] = midpoint_ok(lambda x: x * x * x)  # x times x², both convex
    truth["e"] = midpoint_ok(lambda x: -(x * x))  # (-x) composed with x²
    ok = True
    for f in convex + [lambda x: max(abs(x) - 1, 0.0)]:  # includes a flat-bottomed one
        grid = [f(-3 + k * 0.01) for k in range(601)]
        lowest = min(grid)
        for k in range(1, 600):
            if grid[k] <= grid[k - 1] and grid[k] <= grid[k + 1]:
                ok &= grid[k] - lowest < 1e-12
    truth["f"] = ok
    return {k for k, v in truth.items() if v}


@check("lac-optim-006")
def _():
    best = max(x * x * (3 - x) for x in (F(k, 1000) for k in range(3001)))
    assert best == 4 and F(3, 2) ** 2 * F(3, 2) == F(27, 8)
    return best


@check("lac-optim-007")
def _():
    rng = random.Random(67)
    for _ in range(200):
        u = [F(rng.randint(-9, 9)) for _ in range(5)]
        v = [F(rng.randint(-9, 9)) for _ in range(5)]
        assert dot(u, v) ** 2 <= dot(u, u) * dot(v, v)
    x = [F(v) for v in (1, -2, 3, 5, 0)]
    for slope in (F(3), F(-2)):
        y = [4 + slope * t for t in x]
        mx, my = sum(x) / 5, sum(y) / 5
        sxy = sum((a - mx) * (b - my) for a, b in zip(x, y))
        sxx = sum((a - mx) ** 2 for a in x)
        syy = sum((b - my) ** 2 for b in y)
        assert sxy * sxy == sxx * syy and (sxy > 0) == (slope > 0)  # ρ = ±1, sign of the slope


@check("lac-optim-008")
def _():
    def f(x, y):
        return x**3 - 3 * x * y + y**3

    for x, y in ((0, 0), (1, 1)):
        assert 3 * x * x - 3 * y == 0 and 3 * y * y - 3 * x == 0
    assert det([[0, -3], [-3, 0]]) == -9 and det([[6, -3], [-3, 6]]) == 27
    assert f(1, 1) == -1
    grid = [(1 + i / 100, 1 + j / 100) for i in range(-30, 31) for j in range(-30, 31)]
    assert min(grid, key=lambda p: f(*p)) == (1.0, 1.0)
    assert f(-10, 0) < -1  # not a global minimum
    # (0, 0) is a saddle: f takes both signs arbitrarily close to it
    assert f(0.01, 0.01) < 0 < f(-0.01, 0.01)


# ---------------------------------------------------------------- differential equations


@check("lac-ode-001")
def _():
    theta, mu, x0 = 0.1, 2.0, 5.0
    path = rk4(lambda t, y: [-theta * (y[0] - mu)], 0.0, [x0], 30.0, 3000)
    for t, (x,) in path[::300]:
        assert abs(x - (mu + (x0 - mu) * math.exp(-theta * t))) < 1e-9
    half = math.log(2) / theta
    end = rk4(lambda t, y: [-theta * (y[0] - mu)], 0.0, [x0], half, 1000)[-1][1][0]
    assert abs((end - mu) / (x0 - mu) - 0.5) < 1e-9
    assert abs(math.log(2) / -math.log(0.95) - 13.51) < 0.01


@check("lac-ode-002")
def _():
    path = rk4(lambda x, y: [1 / (x * x) - y[0] / x], 1.0, [0.0], math.e, 20000)
    return path[-1][1][0]


@check("lac-ode-003")
def _():
    # distances c ln((T+s)/T) for s = 1, 2 must be in the ratio 2 : 3; solve for T by bisection
    def gap(t):
        return math.log((t + 2) / t) / math.log((t + 1) / t) - 1.5

    lo, hi = 0.01, 10.0
    assert gap(lo) * gap(hi) < 0
    for _ in range(200):
        mid = (lo + hi) / 2
        if gap(lo) * gap(mid) <= 0:
            hi = mid
        else:
            lo = mid
    t = (lo + hi) / 2
    c = 2 / math.log((t + 1) / t)
    assert abs(c * math.log((t + 2) / t) - 3) < 1e-9
    return 60 * t


@check("lac-ode-004")
def _():
    for y0, v0 in ((1.0, 0.0), (0.0, 1.0), (-2.0, 3.0)):
        path = rk4(lambda t, y: [y[1], -y[1] - y[0]], 0.0, [y0, v0], 40.0, 8000)
        ys = [p[1][0] for p in path]
        changes = sum(1 for a, b in zip(ys, ys[1:]) if a * b < 0)
        assert changes >= 10 and abs(ys[-1]) < 1e-7
    roots = poly_roots([F(1), F(1), F(1)])
    assert all(abs(z.real + 0.5) < 1e-12 and abs(abs(z.imag) - math.sqrt(3) / 2) < 1e-12 for z in roots)
    return "b"
