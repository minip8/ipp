"""Checks for quiz/brainteasers: each settles an answer by search rather than by the explanation's argument.

Puzzles are checked the way a sceptic would: solve the game by backward induction over every
state, search every weighing or pouring strategy for the small case, enumerate every
configuration to confirm an invariant, or simulate the procedure the reference describes and
see that it always works. Where the question is about large numbers (100 prisoners, 64
players) the check settles the small cases exhaustively and runs the stated method on the
large one.
"""

from __future__ import annotations

import heapq
import itertools
import math
import random
from collections import Counter, defaultdict, deque
from fractions import Fraction
from functools import lru_cache

from . import check, simulate

# ================================================================ logic and deduction


@check("bt-logic-001")
def _():
    # Every case: is the asked guard the liar, does the left road lead to the city.
    for asked_liar in (False, True):
        for city_left in (False, True):
            other_liar = not asked_liar
            other_would_say_yes = city_left != other_liar
            reply = other_would_say_yes != asked_liar
            assert reply == (not city_left), "nested question must always point the wrong way"
            you_would_say_yes = city_left != asked_liar
            reply_self = you_would_say_yes != asked_liar
            assert reply_self == city_left, "self-referential question must always be truthful"
    # The plain question does not work: the same reply can come from either road.
    plain = {(liar, left): left != liar for liar in (False, True) for left in (False, True)}
    assert plain[(False, True)] == plain[(True, False)]


def _islanders_first_night(world: tuple[bool, ...]) -> tuple[int, frozenset[int]]:
    """Public-announcement model: S is the set of worlds still common-knowledge possible."""
    n = len(world)
    worlds = {w for w in itertools.product((False, True), repeat=n) if any(w)}

    def leavers(w, possible):
        out = []
        for i in range(n):
            if w[i]:
                flipped = tuple(False if j == i else w[j] for j in range(n))
                if flipped not in possible:
                    out.append(i)
        return frozenset(out)

    night = 0
    while True:
        night += 1
        seen = leavers(world, worlds)
        if seen:
            return night, seen
        worlds = {w for w in worlds if leavers(w, worlds) == seen}
        assert night <= n + 1


@check("bt-logic-002")
def _():
    for n in range(1, 8):
        for world in itertools.product((False, True), repeat=n):
            g = sum(world)
            if g == 0:
                continue
            night, who = _islanders_first_night(world)
            assert night == g, (world, night)
            assert who == frozenset(i for i in range(n) if world[i])
    # Exhaustive for every island of up to 7 people: g green-eyed leave together on night g.
    return 40


@check("bt-logic-003")
def _():
    # Three prisoners, every deterministic strategy: the best guarantee is 2 of 3.
    views = list(itertools.product((0, 1), repeat=2))
    idx = {v: i for i, v in enumerate(views)}
    funcs = list(itertools.product((0, 1), repeat=4))
    best = 0
    for f0 in funcs:
        for f1 in funcs:
            for f2 in funcs:
                worst = 3
                for h in itertools.product((0, 1), repeat=3):
                    c0 = f0[idx[(h[1], h[2])]]
                    c1 = f1[idx[(h[2], c0)]]
                    c2 = f2[idx[(c0, c1)]]
                    worst = min(worst, (c0 == h[0]) + (c1 == h[1]) + (c2 == h[2]))
                best = max(best, worst)
    assert best == 2

    def parity(h):
        calls = []
        for i in range(len(h)):
            ahead = sum(h[i + 1 :])
            calls.append(ahead % 2 if i == 0 else (calls[0] - sum(calls[1:i]) - ahead) % 2)
        return sum(c == x for c, x in zip(calls, h))

    for h in itertools.product((0, 1), repeat=10):
        assert parity(h) >= 9
    rng = random.Random(3)
    for _ in range(300):
        assert parity([rng.randint(0, 1) for _ in range(100)]) >= 99


@check("bt-logic-004")
def _():
    pairs = [(x, y) for x in range(2, 100) for y in range(x + 1, 100) if x + y <= 100]
    by_p: dict[int, list] = defaultdict(list)
    by_s: dict[int, list] = defaultdict(list)
    for x, y in pairs:
        by_p[x * y].append((x, y))
        by_s[x + y].append((x, y))
    step1 = [q for q in pairs if len(by_p[q[0] * q[1]]) > 1]
    sam_knew = {s for s, qs in by_s.items() if all(len(by_p[a * b]) > 1 for a, b in qs)}
    assert sorted(sam_knew) == [11, 17, 23, 27, 29, 35, 37, 41, 47, 53]
    step2 = [q for q in step1 if sum(q) in sam_knew]
    per_product = Counter(a * b for a, b in step2)
    step3 = [q for q in step2 if per_product[q[0] * q[1]] == 1]
    per_sum = Counter(a + b for a, b in step3)
    step4 = [q for q in step3 if per_sum[sum(q)] == 1]
    assert step4 == [(4, 13)]
    return step4[0][0] * step4[0][1]


@check("bt-logic-005")
def _():
    # (A, B, C); A sees B and C, B sees C. Pool: 3 white, 2 black.
    worlds = [w for w in itertools.product("WB", repeat=3) if w.count("B") <= 2]

    def knows(ws, w, me, sees):
        return len({v[me] for v in ws if all(v[k] == w[k] for k in sees)}) == 1

    after_a = [w for w in worlds if not knows(worlds, w, 0, (1, 2))]
    after_b = [w for w in after_a if not knows(after_a, w, 1, (2,))]
    colours = {w[2] for w in after_b}
    assert colours == {"W"}
    return "a"


@check("bt-logic-006")
def _():
    counts = set()
    for knight in itertools.product((False, True), repeat=10):
        knaves = knight.count(False)
        if all(knight[k - 1] == (knaves >= k) for k in range(1, 11)):
            counts.add(knaves)
    assert len(counts) == 1
    return counts.pop()


@check("bt-logic-007")
def _():
    n = 100
    rng = random.Random(7)
    days_total = 0
    runs = 300
    for _ in range(runs):
        light, count, done = False, 0, set()
        visited = set()
        day = 0
        while True:
            day += 1
            p = rng.randrange(n)
            visited.add(p)
            if p == 0:
                if light:
                    light = False
                    count += 1
                    if count == n - 1:
                        assert len(visited) == n
                        break
            elif not light and p not in done:
                light = True
                done.add(p)
        days_total += day
    expected = 100 * sum(Fraction(1, k) for k in range(1, 100)) + 99 * 100
    assert abs(days_total / runs - float(expected)) < 0.03 * float(expected)
    assert 10_000 < expected < 10_500


@check("bt-logic-008")
def _():
    configs = list(itertools.product((0, 1), repeat=3))
    strategies = []
    for person in range(3):
        others = [k for k in range(3) if k != person]
        views = list(itertools.product((0, 1), repeat=2))
        options = []
        for choice in itertools.product((0, 1, 2), repeat=4):  # 2 = pass
            table = dict(zip(views, choice))
            right = wrong = 0
            for c, h in enumerate(configs):
                g = table[(h[others[0]], h[others[1]])]
                if g == 2:
                    continue
                if g == h[person]:
                    right |= 1 << c
                else:
                    wrong |= 1 << c
            options.append((right, wrong))
        strategies.append(options)
    best = 0
    for r0, w0 in strategies[0]:
        for r1, w1 in strategies[1]:
            for r2, w2 in strategies[2]:
                wins = (r0 | r1 | r2) & ~(w0 | w1 | w2) & 0xFF
                best = max(best, bin(wins).count("1"))
    return Fraction(best, 8)


@check("bt-logic-009")
def _():
    funcs = list(itertools.product((0, 1), repeat=2))  # guess for own hat given the other's hat
    some_one = any(
        all((fa[b] == a) or (fb[a] == b) for a in (0, 1) for b in (0, 1)) for fa in funcs for fb in funcs
    )
    both = any(all(fa[b] == a and fb[a] == b for a in (0, 1) for b in (0, 1)) for fa in funcs for fb in funcs)
    assert some_one and not both
    # The reference strategy: Alice copies, Bob inverts.
    assert all((b == a) or ((1 - a) == b) for a in (0, 1) for b in (0, 1))


@check("bt-logic-010")
def _():
    labels = ("A", "O", "M")
    contents = [p for p in itertools.permutations(labels) if all(p[i] != labels[i] for i in range(3))]

    def fruits(c):
        return ("apple", "orange") if c == "M" else ("apple" if c == "A" else "orange",)

    works = []
    for box in range(3):
        seen: dict[str, set] = defaultdict(set)
        for p in contents:
            for f in fruits(p[box]):
                seen[f].add(p)
        if all(len(v) == 1 for v in seen.values()):
            works.append(labels[box])
    assert works == ["M"]
    return "c"


# ================================================================ weighing and measuring


def _weighings_needed(u: int, h: int, l: int, g: int, limit: int) -> int | None:
    """Fewest weighings that find the odd coin and its direction, or None if more than `limit`.

    State by classes of interchangeable coins: u could be heavy or light, h only heavy, l only
    light, g known genuine.
    """

    @lru_cache(maxsize=None)
    def can(u, h, l, g, k):
        poss = 2 * u + h + l
        if poss <= 1:
            return True
        if k == 0 or poss > 3**k:
            return False
        cap = 3 ** (k - 1)
        for u1 in range(u + 1):
            for u2 in range(u - u1 + 1):
                for h1 in range(h + 1):
                    for h2 in range(h - h1 + 1):
                        for l1 in range(l + 1):
                            for l2 in range(l - l1 + 1):
                                left, right = u1 + h1 + l1, u2 + h2 + l2
                                need = abs(left - right)
                                if need > g or left + right == 0:
                                    continue
                                outs = [
                                    (u - u1 - u2, h - h1 - h2, l - l1 - l2, g + u1 + u2 + h1 + h2 + l1 + l2),
                                    (0, u1 + h1, u2 + l2, g + (u - u1 - u2) + (h - h1) + (l - l2)),
                                    (0, u2 + h2, u1 + l1, g + (u - u1 - u2) + (h - h2) + (l - l1)),
                                ]
                                outs = [o for o in outs if 2 * o[0] + o[1] + o[2] > 0]
                                if any(2 * o[0] + o[1] + o[2] > cap for o in outs):
                                    continue
                                if all(can(*o, k - 1) for o in outs):
                                    return True
        return False

    for k in range(limit + 1):
        if can(u, h, l, g, k):
            return k
    return None


@check("bt-weighing-001")
def _():
    assert _weighings_needed(12, 0, 0, 0, 3) == 3
    assert _weighings_needed(13, 0, 0, 0, 3) is None
    assert _weighings_needed(39, 0, 0, 0, 4) == 4
    assert _weighings_needed(40, 0, 0, 0, 4) is None

    # Run the reference procedure on all 24 cases.
    def weigh(left, right, fake, heavy):
        w = lambda pan: sum((1 if heavy else -1) if c == fake else 0 for c in pan)  # noqa: E731
        d = w(left) - w(right)
        return "L" if d > 0 else ("R" if d < 0 else "=")

    def solve(fake, heavy):
        first = weigh([1, 2, 3, 4], [5, 6, 7, 8], fake, heavy)
        if first == "=":
            second = weigh([9, 10, 11], [1, 2, 3], fake, heavy)
            if second == "=":
                return 12, weigh([12], [1], fake, heavy) == "L"
            is_heavy = second == "L"
            third = weigh([9], [10], fake, heavy)
            if third == "=":
                return 11, is_heavy
            return (9 if (third == "L") == is_heavy else 10), is_heavy
        # first is unbalanced; mirror the labels so the left pan was heavier
        if first == "L":
            a = {k: k for k in range(1, 13)}
        else:
            a = {1: 5, 2: 6, 3: 7, 4: 8, 5: 1, 6: 2, 7: 3, 8: 4, 9: 9, 10: 10, 11: 11, 12: 12}
        second = weigh([a[1], a[2], a[5]], [a[3], a[6], a[9]], fake, heavy)
        if second == "L":
            third = weigh([a[1]], [a[2]], fake, heavy)
            if third == "L":
                return a[1], True
            if third == "R":
                return a[2], True
            return a[6], False
        if second == "R":
            third = weigh([a[3]], [a[9]], fake, heavy)
            return (a[3], True) if third == "L" else (a[5], False)
        third = weigh([a[7]], [a[8]], fake, heavy)
        if third == "L":
            return a[8], False
        if third == "R":
            return a[7], False
        return a[4], True

    for fake in range(1, 13):
        for heavy in (True, False):
            assert solve(fake, heavy) == (fake, heavy), (fake, heavy)


@check("bt-weighing-002")
def _():
    # One bag of 11 g coins among b bags of 10 g coins; brute force the cheapest sample.
    for b in range(2, 6):
        best = None
        for counts in itertools.product(range(b + 1), repeat=b):
            readings = [counts[i] for i in range(b)]  # excess grams if bag i is the fake one
            if len(set(readings)) == b:
                t = sum(counts)
                best = t if best is None else min(best, t)
        assert best == b * (b - 1) // 2
    counts = list(range(10))
    readings = {10 * sum(counts) + counts[i] for i in range(10)}
    assert len(readings) == 10
    # Any identifying sample needs ten different counts, and ten different non-negative
    # integers sum to at least 0 + 1 + ... + 9.
    return sum(sorted(counts))


@check("bt-weighing-003")
def _():
    def distinct(counts):
        seen = set()
        for devs in itertools.product((-1, 0, 1), repeat=len(counts)):
            r = sum(c * d for c, d in zip(counts, devs))
            if r in seen:
                return False
            seen.add(r)
        return True

    for b, expected in ((2, 4), (3, 13)):
        best = min(sum(c) for c in itertools.product(range(15), repeat=b) if distinct(c))
        assert best == expected
    assert distinct((1, 3, 9, 27, 81))
    # with T coins the reading's deviation lies in [-T, T]: 2T + 1 values for 3^5 cases
    t = 0
    while 2 * t + 1 < 3**5:
        t += 1
    assert t == 121 == sum((1, 3, 9, 27, 81))
    return t


@check("bt-weighing-004")
def _():
    tasters = 7
    digits = {}
    for bottle in range(1000):
        d, x = [], bottle
        for _ in range(tasters):
            d.append(x % 3)
            x //= 3
        digits[bottle] = d
    outcomes = {}
    for poisoned in range(1000):
        fate = []
        for t in range(tasters):
            # digit 0: drinks in round 1; digit 1: drinks in round 2 if alive; 2: never
            d = digits[poisoned][t]
            fate.append("dies1" if d == 0 else ("dies2" if d == 1 else "lives"))
        key = tuple(fate)
        assert key not in outcomes
        outcomes[key] = poisoned
    assert 3 ** (tasters - 1) < 1000 <= 3**tasters
    return tasters


@check("bt-weighing-005")
def _():
    start, caps = (0, 0), (3, 5)
    dist = {start: 0}
    queue = deque([start])
    while queue:
        a, b = queue.popleft()
        nxt = [(3, b), (a, 5), (0, b), (a, 0)]
        pour = min(a, caps[1] - b)
        nxt.append((a - pour, b + pour))
        pour = min(b, caps[0] - a)
        nxt.append((a + pour, b - pour))
        for s in nxt:
            if s not in dist:
                dist[s] = dist[(a, b)] + 1
                queue.append(s)
    assert {b for _, b in dist} == set(range(6))
    return min(d for (a, b), d in dist.items() if b == 4)


def _burn_both_ends(segments):
    """Time for a rope (segments = minutes each piece takes from one end) lit at both ends."""
    left, right = 0, len(segments) - 1
    tl = tr = 0.0
    rem = list(segments)
    while left < right:
        if tl + rem[left] <= tr + rem[right]:
            tl += rem[left]
            left += 1
        else:
            tr += rem[right]
            right -= 1
    # the last piece is eaten from both sides
    a, b = tl, tr
    piece = rem[left]
    # flames reach the piece at times a and b and eat it at the same rate (piece per piece-time)
    return (a + b + piece) / 2


@check("bt-weighing-006")
def _():
    rng = random.Random(11)
    for _ in range(500):
        n = rng.randint(1, 40)
        w = [rng.random() ** 3 for _ in range(n)]
        s = sum(w)
        seg = [60 * x / s for x in w]
        assert abs(_burn_both_ends(seg) - 30) < 1e-9
        # rope B: lit at one end at time 0; at time 30 the other end is lit
        burnt, i = 0.0, 0
        while burnt + seg[i] <= 30:
            burnt += seg[i]
            i += 1
        rest = [seg[i] - (30 - burnt)] + seg[i + 1 :]
        assert abs(30 + _burn_both_ends(rest) - 45) < 1e-9


@check("bt-weighing-007")
def _():
    caps = (4, 7)
    # state: (time, sand in the top of each glass); act only at time 0 or when a glass runs out
    events = set()
    seen = set()
    queue = deque([(0, 0, 0)])
    while queue:
        t, a, b = queue.popleft()
        if (t, a, b) in seen or t > 30:
            continue
        seen.add((t, a, b))
        events.add(t)
        for fa in (False, True):
            for fb in (False, True):
                na = caps[0] - a if fa else a
                nb = caps[1] - b if fb else b
                running = [x for x in (na, nb) if x > 0]
                if not running:
                    continue
                step = min(running)
                queue.append((t + step, na - step if na else 0, nb - step if nb else 0))
    assert 9 in events and all(t in events for t in (4, 7, 8))

    # replay the reference schedule: tops of the 4- and 7-minute glasses
    def run(a, b, t):
        step = min(x for x in (a, b) if x > 0)
        return (a - step if a else 0), (b - step if b else 0), t + step

    a, b, t = run(4, 7, 0)  # start both
    assert (a, b, t) == (0, 3, 4)
    a, b, t = run(4, b, t)  # flip the 4
    assert (a, b, t) == (1, 0, 7)
    a, b, t = run(a, 7, t)  # flip the 7
    assert (a, b, t) == (0, 6, 8)
    a, b, t = run(a, 7 - b, t)  # flip the 7 again: one minute of sand on top
    assert (b, t) == (0, 9)


# ================================================================ invariants, parity, colouring


def _max_matching(cells: set[tuple[int, int]]) -> int:
    black = [c for c in cells if (c[0] + c[1]) % 2 == 0]
    match: dict[tuple[int, int], tuple[int, int]] = {}

    def augment(u, seen):
        r, c = u
        for v in ((r + 1, c), (r - 1, c), (r, c + 1), (r, c - 1)):
            if v in cells and v not in seen:
                seen.add(v)
                if v not in match or augment(match[v], seen):
                    match[v] = u
                    return True
        return False

    return sum(augment(u, set()) for u in black)


@check("bt-invariants-001")
def _():
    cells = {(r, c) for r in range(8) for c in range(8)} - {(0, 0), (7, 7)}
    assert _max_matching(cells) == 30
    # removing two squares of opposite colours leaves a perfect matching here
    assert _max_matching({(r, c) for r in range(8) for c in range(8)} - {(0, 0), (7, 6)}) == 31
    return "b"


@check("bt-invariants-002")
def _():
    start = (10, 14, 19)
    seen = {start}
    queue = deque([start])
    while queue:
        s = queue.popleft()
        for i, j in ((0, 1), (0, 2), (1, 2)):
            if s[i] and s[j]:
                t = list(s)
                t[i] -= 1
                t[j] -= 1
                t[3 - i - j] += 2
                t = tuple(t)
                if t not in seen:
                    seen.add(t)
                    queue.append(t)
    total = sum(start)
    mono = [k for k in range(3) if tuple(total if i == k else 0 for i in range(3)) in seen]
    assert mono == [1]
    return "b"


@check("bt-invariants-003")
def _():
    @lru_cache(maxsize=None)
    def finals(state):
        if len(state) == 1:
            return frozenset(state)
        out = set()
        for i in range(len(state)):
            for j in range(i + 1, len(state)):
                if j > i + 1 and state[j] == state[j - 1]:
                    continue
                rest = state[:i] + state[i + 1 : j] + state[j + 1 :]
                out |= finals(tuple(sorted(rest + (abs(state[i] - state[j]),))))
        return frozenset(out)

    reachable = finals(tuple(range(1, 11)))
    assert reachable == {1, 3, 5, 7, 9}
    values = {"a": 0, "b": 1, "c": 5, "d": 9, "e": 10, "f": 55}
    return {k for k, v in values.items() if v in reachable}


@check("bt-invariants-004")
def _():
    rng = random.Random(5)
    results = set()
    for _ in range(5):
        nums = [Fraction(1, k) for k in range(1, 101)]
        while len(nums) > 1:
            i, j = rng.sample(range(len(nums)), 2)
            a, b = nums[i], nums[j]
            nums = [x for k, x in enumerate(nums) if k not in (i, j)] + [a + b + a * b]
        results.add(nums[0])
    assert len(results) == 1
    return results.pop()


def _tiles_1x4(rows: int, cols: int) -> bool:
    n = rows * cols
    full = (1 << n) - 1

    @lru_cache(maxsize=None)
    def go(mask):
        if mask == full:
            return True
        p = (~mask & (mask + 1)).bit_length() - 1  # first empty cell
        r, c = divmod(p, cols)
        if c + 4 <= cols:
            bits = 0b1111 << p
            if not mask & bits and go(mask | bits):
                return True
        if r + 4 <= rows:
            bits = sum(1 << (p + k * cols) for k in range(4))
            if not mask & bits and go(mask | bits):
                return True
        return False

    return go(0)


@check("bt-invariants-005")
def _():
    assert _tiles_1x4(8, 8) and _tiles_1x4(4, 10)
    assert not _tiles_1x4(6, 6)
    assert not _tiles_1x4(10, 10)
    counts = Counter((r + c) % 4 for r in range(10) for c in range(10))
    assert sorted(counts.values()) == [24, 25, 25, 26]


@check("bt-invariants-006")
def _():
    base = [[(r + c) % 2 for c in range(8)] for r in range(8)]
    counts = set()
    for rows in range(256):
        for cols in range(256):
            black = 0
            for r in range(8):
                for c in range(8):
                    black += base[r][c] ^ ((rows >> r) & 1) ^ ((cols >> c) & 1)
            counts.add(black)
    assert 1 not in counts
    assert all(x % 2 == 0 for x in counts) and len(counts) > 1  # it changes, but only by even steps
    return "b"


def _infects_all(n, start):
    inf = set(start)
    while True:
        new = {
            (r, c)
            for r in range(n)
            for c in range(n)
            if (r, c) not in inf
            and sum((r + dr, c + dc) in inf for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1))) >= 2
        }
        if not new:
            return len(inf) == n * n
        inf |= new


@check("bt-invariants-007")
def _():
    for n in (3, 4, 5):
        cells = [(r, c) for r in range(n) for c in range(n)]
        assert not any(_infects_all(n, s) for s in itertools.combinations(cells, n - 1))
        assert any(_infects_all(n, s) for s in itertools.combinations(cells, n))
    assert _infects_all(8, [(i, i) for i in range(8)])

    # the perimeter never increases along any run
    def perimeter(inf):
        return sum(
            (r + dr, c + dc) not in inf for r, c in inf for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1))
        )

    rng = random.Random(2)
    for _ in range(200):
        inf = {(rng.randrange(8), rng.randrange(8)) for _ in range(rng.randint(5, 20))}
        p = perimeter(inf)
        while True:
            new = {
                (r, c)
                for r in range(8)
                for c in range(8)
                if (r, c) not in inf
                and sum((r + dr, c + dc) in inf for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1))) >= 2
            }
            if not new:
                break
            for cell in new:  # add one at a time: each step alone must not raise it
                inf.add(cell)
                q = perimeter(inf)
                assert q <= p
                p = q


@check("bt-invariants-008")
def _():
    n = 5
    moves = [(1, 2), (2, 1), (-1, 2), (-2, 1), (1, -2), (2, -1), (-1, -2), (-2, -1)]
    nbrs = {
        (r, c): [(r + a, c + b) for a, b in moves if 0 <= r + a < n and 0 <= c + b < n]
        for r in range(n)
        for c in range(n)
    }
    assert all((u[0] + u[1]) % 2 != (v[0] + v[1]) % 2 for u in nbrs for v in nbrs[u])

    # an open tour exists (Warnsdorff with backtracking), so only the closing move is impossible
    def tour(path, seen):
        if len(path) == n * n:
            return path
        for v in sorted(nbrs[path[-1]], key=lambda v: sum(w not in seen for w in nbrs[v])):
            if v not in seen:
                seen.add(v)
                r = tour(path + [v], seen)
                if r:
                    return r
                seen.discard(v)
        return None

    t = tour([(0, 0)], {(0, 0)})
    assert t and len(set(t)) == 25 and t[-1] not in nbrs[t[0]]


@check("bt-invariants-009")
def _():
    @lru_cache(maxsize=None)
    def totals(a, b):
        if a == b == 1:
            return frozenset({0})
        out = set()
        for k in range(1, a):
            out |= {1 + x + y for x in totals(k, b) for y in totals(a - k, b)}
        for k in range(1, b):
            out |= {1 + x + y for x in totals(a, k) for y in totals(a, b - k)}
        return frozenset(out)

    t = totals(6, 8)
    assert len(t) == 1
    return min(t)


# ================================================================ pigeonhole and extremal


@check("bt-pigeonhole-001")
def _():
    have = (10, 8, 6)
    k = 1
    while True:
        draws = [d for d in itertools.product(*(range(h + 1) for h in have)) if sum(d) == k]
        if all(max(d) >= 2 for d in draws):
            return k
        k += 1


@check("bt-pigeonhole-002")
def _():
    for n in range(2, 7):
        edges = list(itertools.combinations(range(n), 2))
        for mask in range(1 << len(edges)):
            deg = [0] * n
            for i, (a, b) in enumerate(edges):
                if mask >> i & 1:
                    deg[a] += 1
                    deg[b] += 1
            assert len(set(deg)) < n


@check("bt-pigeonhole-003")
def _():
    def mono_triangle(n, colour):
        return any(
            colour[(a, b)] == colour[(a, c)] == colour[(b, c)] for a, b, c in itertools.combinations(range(n), 3)
        )

    edges6 = list(itertools.combinations(range(6), 2))
    for mask in range(1 << 15):
        assert mono_triangle(6, {e: mask >> i & 1 for i, e in enumerate(edges6)})
    pentagon = {(a, b): int((b - a) % 5 in (1, 4)) for a, b in itertools.combinations(range(5), 2)}
    assert not mono_triangle(5, pentagon)


@check("bt-pigeonhole-004")
def _():
    assert math.sqrt(2) / 10 < 1 / 7
    rng = random.Random(4)
    for _ in range(2000):
        pts = [(rng.random(), rng.random()) for _ in range(76)]
        cells = Counter((min(int(x * 5), 4), min(int(y * 5), 4)) for x, y in pts)
        (cx, cy), k = cells.most_common(1)[0]
        assert k >= 4
        centre = ((cx + 0.5) / 5, (cy + 0.5) / 5)
        inside = [p for p in pts if (min(int(p[0] * 5), 4), min(int(p[1] * 5), 4)) == (cx, cy)]
        assert all(math.dist(p, centre) <= 1 / 7 for p in inside)


@check("bt-pigeonhole-005")
def _():
    def max_antichain(m):
        best = 0
        nums = list(range(1, m + 1))
        for mask in range(1 << m):
            chosen = [nums[i] for i in range(m) if mask >> i & 1]
            if len(chosen) <= best:
                continue
            if all(b % a for a, b in itertools.combinations(chosen, 2)):
                best = len(chosen)
        return best

    for n in range(1, 9):
        assert max_antichain(2 * n) == n
    top = range(51, 101)
    assert all(b % a for a, b in itertools.combinations(top, 2))

    def odd_part(x):
        while x % 2 == 0:
            x //= 2
        return x

    chains = {odd_part(x) for x in range(1, 101)}
    assert len(chains) == 50 == len(top)
    return len(top)


@check("bt-pigeonhole-006")
def _():
    def cross(p, q, r, s):
        def orient(a, b, c):
            return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

        return orient(p, q, r) * orient(p, q, s) < 0 and orient(r, s, p) * orient(r, s, q) < 0

    rng = random.Random(6)
    for _ in range(300):
        red = [(rng.random(), rng.random()) for _ in range(5)]
        blue = [(rng.random(), rng.random()) for _ in range(5)]
        best = min(itertools.permutations(range(5)), key=lambda p: sum(math.dist(red[i], blue[p[i]]) for i in range(5)))
        segs = [(red[i], blue[best[i]]) for i in range(5)]
        assert not any(cross(*a, *b) for a, b in itertools.combinations(segs, 2))


@check("bt-pigeonhole-007")
def _():
    def ok(p):  # p already avoids both patterns; test only sequences ending at the new term
        inc = [1] * len(p)
        dec = [1] * len(p)
        for i in range(len(p)):
            for j in range(i):
                if p[j] < p[i]:
                    inc[i] = max(inc[i], inc[j] + 1)
                else:
                    dec[i] = max(dec[i], dec[j] + 1)
        return inc[-1] <= 3 and dec[-1] <= 3

    layer = [(0,)]
    sizes = {1: 1}
    for k in range(1, 10):
        nxt = []
        for p in layer:
            for r in range(k + 1):
                q = tuple(v + (v >= r) for v in p) + (r,)
                if ok(q):
                    nxt.append(q)
        layer = nxt
        sizes[k + 1] = len(layer)
    assert sizes[9] == 42 * 42
    assert sizes[10] == 0
    return max(k for k, v in sizes.items() if v)


@check("bt-pigeonhole-008")
def _():
    rng = random.Random(8)
    for _ in range(300):
        s = rng.sample(range(1, 101), 10)
        assert len({x % 9 for x in s}) < 10
        sums: dict[int, int] = {}
        found = False
        for mask in range(1, 1 << 10):
            t = sum(s[i] for i in range(10) if mask >> i & 1)
            if t in sums:
                a, b = sums[t], mask
                common = a & b
                a, b = a & ~common, b & ~common
                assert a and b and not a & b
                assert sum(s[i] for i in range(10) if a >> i & 1) == sum(s[i] for i in range(10) if b >> i & 1)
                found = True
                break
            sums[t] = mask
        assert found
    assert sum(range(91, 101)) < 2**10 - 1
    assert len({x % 10 for x in range(1, 11)}) == 10  # b fails
    assert all(b % a for a, b in itertools.combinations(range(51, 61), 2))  # d fails
    assert all(math.gcd(a, b) > 1 for a, b in itertools.combinations(range(2, 21, 2), 2))  # e fails
    return {"a", "c"}


# ================================================================ strategy games


@check("bt-games-001")
def _():
    @lru_cache(maxsize=None)
    def outcome(n, coins):
        """The unique optimal allocation (senior first) with n pirates, found by exhaustive search."""
        if n == 1:
            return (coins,)
        cont = outcome(n - 1, coins)  # what pirates 2..n get if pirate 1 goes overboard
        need = (n + 1) // 2 - 1  # yes votes needed besides the proposer's own ("at least half")
        for given in range(coins + 1):  # coins handed to the others: fewer is better for the proposer
            winners = []
            for alloc in itertools.product(range(given + 1), repeat=n - 1):
                if sum(alloc) != given:
                    continue
                yes = sum(alloc[i] > cont[i] for i in range(n - 1))
                if yes >= need:
                    winners.append((coins - given,) + alloc)
            if winners:
                assert len(winners) == 1, (n, winners)
                return winners[0]
        raise AssertionError("no proposal passes")

    assert outcome(5, 100) == (98, 0, 1, 0, 1)
    assert outcome(5, 7) == (5, 0, 1, 0, 1)


@check("bt-games-002")
def _():
    @lru_cache(maxsize=None)
    def eaten(n):  # is the sheep eaten when there are n tigers?
        if n == 0:
            return False
        return not eaten(n - 1)  # a tiger eats exactly when, as the new sheep, it would be safe

    assert not eaten(100) and eaten(101)


@check("bt-games-003")
def _():
    win = [False] * 24
    for n in range(1, 24):
        win[n] = any(not win[n - k] for k in range(1, 5) if k <= n)
    moves = [k for k in range(1, 5) if not win[23 - k]]
    assert len(moves) == 1
    return moves[0]


@check("bt-games-004")
def _():
    @lru_cache(maxsize=None)
    def wins(piles):
        for i, p in enumerate(piles):
            for take in range(1, p + 1):
                nxt = tuple(sorted(piles[:i] + (p - take,) + piles[i + 1 :]))
                if not wins(nxt):
                    return True
        return False

    start = (3, 4, 5)
    good = [
        (i, take)
        for i, p in enumerate(start)
        for take in range(1, p + 1)
        if not wins(tuple(sorted(start[:i] + (p - take,) + start[i + 1 :])))
    ]
    assert good == [(0, 2)]
    return good[0][1]


@check("bt-games-005")
def _():
    rng = random.Random(9)

    def best_first(coins):
        @lru_cache(maxsize=None)
        def v(i, j):  # best margin for the player to move on coins[i..j]
            if i > j:
                return 0
            return max(coins[i] - v(i + 1, j), coins[j] - v(i, j - 1))

        return v(0, len(coins) - 1)

    def parity_guarantee(coins, target):
        """First player takes only coins at indices of parity `target`; worst case over opponents."""

        @lru_cache(maxsize=None)
        def worst(i, j, mine):
            if i > j:
                return 0
            if mine:
                k = i if i % 2 == target else j
                assert k % 2 == target
                return coins[k] + (worst(i + 1, j, False) if k == i else worst(i, j - 1, False))
            return min(worst(i + 1, j, True), worst(i, j - 1, True))

        return worst(0, len(coins) - 1, True)

    for _ in range(300):
        coins = tuple(rng.randint(1, 20) for _ in range(2 * rng.randint(1, 6)))
        assert best_first(coins) >= 0
        for target in (0, 1):
            assert parity_guarantee(coins, target) >= sum(coins[target::2])


@check("bt-games-006")
def _():
    @lru_cache(maxsize=None)
    def wins(shape):  # shape: non-increasing row lengths; square (0,0) is poisoned
        for r, length in enumerate(shape):
            for c in range(length):
                if (r, c) == (0, 0):
                    continue
                nxt = tuple(x for x in (min(x, c) if i >= r else x for i, x in enumerate(shape)) if x > 0)
                if not wins(nxt):
                    return True
        return False  # only the poisoned square left (or nothing better): you must eat it

    for m in range(1, 5):
        for n in range(1, 6):
            assert wins((n,) * m) == ((m, n) != (1, 1)), (m, n)


@check("bt-games-008")
def _():
    triples = [t for t in itertools.combinations(range(1, 10), 3) if sum(t) == 15]

    def has(s):
        return any(all(x in s for x in t) for t in triples)

    @lru_cache(maxsize=None)
    def value(mine, theirs):  # from the point of view of the player to move
        free = [x for x in range(1, 10) if x not in mine and x not in theirs]
        if not free:
            return 0
        best = -1
        for x in free:
            m = mine | frozenset([x])
            v = 1 if has(m) else -value(theirs, m)
            best = max(best, v)
            if best == 1:
                break
        return best

    assert value(frozenset(), frozenset()) == 0
    return "c"


@check("bt-games-010")
def _():
    n_max = 2025
    win = [False] * (n_max + 1)
    for n in range(2, n_max + 1):
        divs = [d for d in range(1, int(math.isqrt(n)) + 1) if n % d == 0]
        divs = {d for x in divs for d in (x, n // x) if d < n}
        win[n] = any(not win[n - d] for d in divs)
    assert all(win[n] == (n % 2 == 0) for n in range(1, n_max + 1))
    return "a" if win[n_max] else "b"


# ================================================================ optimisation and worst case


@check("bt-worst-case-001")
def _():
    @lru_cache(maxsize=None)
    def drops(eggs, floors):
        if floors == 0:
            return 0
        if eggs == 1:
            return floors
        return 1 + min(max(drops(eggs - 1, k - 1), drops(eggs, floors - k)) for k in range(1, floors + 1))

    return drops(2, 100)


def _bridge(times):
    everyone = frozenset(range(len(times)))
    start = (everyone, True)  # who is on the near side, torch on the near side
    best = {start: 0}
    heap = [(0, 0, start)]
    counter = 0
    while heap:
        d, _, (near, torch) = heapq.heappop(heap)
        if not near:
            return d
        if d > best[(near, torch)]:
            continue
        side = near if torch else everyone - near
        groups = [frozenset(g) for k in (1, 2) for g in itertools.combinations(sorted(side), k)]
        for g in groups:
            cost = max(times[i] for i in g)
            nxt = (near - g if torch else near | g, not torch)
            if d + cost < best.get(nxt, math.inf):
                best[nxt] = d + cost
                counter += 1
                heapq.heappush(heap, (d + cost, counter, nxt))
    raise AssertionError


@check("bt-worst-case-002")
def _():
    assert _bridge((1, 2, 5, 10)) == 17
    assert _bridge((1, 4, 5, 10)) == 21
    return _bridge((1, 2, 6, 9))


@check("bt-worst-case-003")
def _():
    rng = random.Random(10)

    def race(horses, speed):
        return sorted(horses, key=lambda h: -speed[h])

    for _ in range(2000):
        speed = {h: rng.random() for h in range(25)}
        heats = [race(range(5 * k, 5 * k + 5), speed) for k in range(5)]
        order = race([h[0] for h in heats], speed)
        by_winner = {h[0]: h for h in heats}
        a, b, c = (by_winner[w] for w in order[:3])
        final = race([a[1], a[2], b[0], b[1], c[0]], speed)
        found = [a[0], final[0], final[1]]
        assert found == sorted(range(25), key=lambda h: -speed[h])[:3]


@check("bt-worst-case-004")
def _():
    import sys

    sys.setrecursionlimit(10_000)

    @lru_cache(maxsize=None)
    def cost(u, w, l):
        if u == 0 and w == 1 and l == 1:
            return 0
        options = []
        if u >= 2:
            options.append([(u - 2, w + 1, l + 1)])
        if u >= 1 and w >= 1:
            options.append([(u - 1, w, l), (u - 1, w, l + 1)])
        if u >= 1 and l >= 1:
            options.append([(u - 1, w, l), (u - 1, w + 1, l)])
        if w >= 2:
            options.append([(u, w - 1, l)])
        if l >= 2:
            options.append([(u, w, l - 1)])
        return 1 + min(max(cost(*o) for o in outs) for outs in options)

    for n in range(2, 12):
        assert cost(n, 0, 0) == math.ceil(3 * n / 2) - 2
    # the pairing algorithm on 100 numbers, counting comparisons
    rng = random.Random(1)
    xs = rng.sample(range(10**6), 100)
    comparisons = 0
    big, small = [], []
    for i in range(0, 100, 2):
        comparisons += 1
        a, b = xs[i], xs[i + 1]
        big.append(max(a, b))
        small.append(min(a, b))
    hi, lo = big[0], small[0]
    for x in big[1:]:
        comparisons += 1
        hi = max(hi, x)
    for x in small[1:]:
        comparisons += 1
        lo = min(lo, x)
    assert (hi, lo) == (max(xs), min(xs))
    value = cost(100, 0, 0)
    assert comparisons == value
    return value


@check("bt-worst-case-005")
def _():
    def pays(pieces):
        sums = {sum(c) for k in range(len(pieces) + 1) for c in itertools.combinations(pieces, k)}
        return all(d in sums for d in range(1, 8))

    one_cut = [(k, 7 - k) for k in range(1, 7)]
    assert not any(pays(p) for p in one_cut)
    two_cuts = [(a, b - a, 7 - b) for a in range(1, 7) for b in range(a + 1, 7)]
    good = {tuple(sorted(p)) for p in two_cuts if pays(p)}
    assert good == {(1, 2, 4)}


@check("bt-worst-case-006")
def _():
    def walked(r, gate_side, gate_dist):
        total, k = 0.0, 0
        while True:
            reach = r**k
            side = k % 2
            if side == gate_side and reach >= gate_dist:
                return total + gate_dist
            total += 2 * reach
            k += 1

    def worst(r):
        ratio = 0.0
        for k in range(0, 40):
            d = r**k * (1 + 1e-9)
            if d < 1:
                continue
            ratio = max(ratio, walked(r, k % 2, d) / d)
        return ratio

    w2 = worst(2.0)
    assert 8.99 < w2 < 9.0
    grid = [1.5 + 0.05 * i for i in range(31)]
    best_r = min(grid, key=worst)
    assert abs(best_r - 2.0) < 1e-9


@check("bt-worst-case-007")
def _():
    rng = random.Random(12)
    for _ in range(300):
        n = rng.randint(1, 50)
        pos = sorted(rng.random() for _ in range(n))
        dirs = [rng.choice((-1, 1)) for _ in range(n)]
        ants = [[p, d] for p, d in zip(pos, dirs)]
        t = 0.0
        while ants:
            # next event: a fall or a meeting of neighbours facing each other
            nxt, kind = math.inf, None
            for i, (p, d) in enumerate(ants):
                fall = (1 - p) if d == 1 else p
                if fall < nxt:
                    nxt, kind = fall, ("fall", i)
            for i in range(len(ants) - 1):
                if ants[i][1] == 1 and ants[i + 1][1] == -1:
                    meet = (ants[i + 1][0] - ants[i][0]) / 2
                    if meet < nxt:
                        nxt, kind = meet, ("meet", i)
            t += nxt
            for a in ants:
                a[0] += a[1] * nxt
            if kind[0] == "fall":
                ants.pop(kind[1])
            else:
                i = kind[1]
                ants[i][1], ants[i + 1][1] = -1, 1
        expected = max(((1 - p) if d == 1 else p) for p, d in zip(pos, dirs))
        assert abs(t - expected) < 1e-9 and t <= 1
    return "a"


@check("bt-worst-case-008")
def _():
    def minimax(n):
        def decided(below):
            above = [0] * n
            for i in range(n):
                for j in range(n):
                    if below[i] >> j & 1:
                        above[j] |= 1 << i
            tops = [i for i in range(n) if above[i] == 0]
            if len(tops) != 1:
                return False
            m = tops[0]
            second = [i for i in range(n) if i != m and above[i] & ~(1 << m) == 0]
            return len(second) == 1

        @lru_cache(maxsize=None)
        def cost(below):
            if decided(below):
                return 0
            best = math.inf
            for i in range(n):
                for j in range(i + 1, n):
                    if below[i] >> j & 1 or below[j] >> i & 1:
                        continue
                    worst = 0
                    for hi, lo in ((i, j), (j, i)):
                        b = list(below)
                        gain = b[lo] | (1 << lo)
                        for k in range(n):
                            if k == hi or b[k] >> hi & 1:
                                b[k] |= gain
                        worst = max(worst, cost(tuple(b)))
                        if worst + 1 >= best:
                            break
                    best = min(best, 1 + worst)
            return best

        return cost(tuple(0 for _ in range(n)))

    for n in range(2, 7):
        assert minimax(n) == n + math.ceil(math.log2(n)) - 2, n

    # knockout then a knockout among those beaten by the champion, on 64 random players
    rng = random.Random(13)
    for _ in range(200):
        strength = rng.sample(range(10**6), 64)
        matches = 0
        beaten_by = defaultdict(list)
        alive = list(range(64))
        while len(alive) > 1:
            nxt = []
            for a, b in zip(alive[::2], alive[1::2]):
                matches += 1
                w, l = (a, b) if strength[a] > strength[b] else (b, a)
                beaten_by[w].append(l)
                nxt.append(w)
            alive = nxt
        champ = alive[0]
        cands = beaten_by[champ]
        second = cands[0]
        for c in cands[1:]:
            matches += 1
            if strength[c] > strength[second]:
                second = c
        order = sorted(range(64), key=lambda p: -strength[p])
        assert (champ, second) == (order[0], order[1]) and matches == 68
    return 64 + 6 - 2


# ================================================================ numbers


@check("bt-numbers-001")
def _():
    s = str(math.factorial(200))
    return len(s) - len(s.rstrip("0"))


@check("bt-numbers-002")
def _():
    open_ = [False] * 101
    for k in range(1, 101):
        for n in range(k, 101, k):
            open_[n] = not open_[n]
    assert [n for n in range(1, 101) if open_[n]] == [k * k for k in range(1, 11)]


@check("bt-numbers-003")
def _():
    # relative angle (minute minus hour) in degrees, exactly, at each whole minute of the day;
    # an overlap happens in [m, m+1) when the relative angle passes a multiple of 360
    def rel(t):  # t in minutes after midnight
        return Fraction(6) * t - Fraction(1, 2) * t

    count = 0
    for m in range(24 * 60):
        a, b = rel(m), rel(m + 1)
        # multiples of 360 in [a, b)
        lo = math.ceil(a / 360)
        hi = math.ceil(b / 360)
        count += hi - lo
    assert count == 22
    return "c"


@check("bt-numbers-004")
def _():
    t = 2 * 60 + 45  # minutes after 12:00
    hour = Fraction(1, 2) * t % 360
    minute = Fraction(6) * t % 360
    d = abs(hour - minute)
    return min(d, 360 - d)


@check("bt-numbers-005")
def _():
    found = [
        int("".join(p))
        for p in itertools.permutations("123456789")
        if all(int("".join(p[:k])) % k == 0 for k in range(2, 10))
    ]
    assert len(found) == 1
    return found[0]


@check("bt-numbers-006")
def _():
    return {30: "a", 31: "b", 32: "c", 101: "d"}[len(str(2**100))]


@check("bt-numbers-007")
def _():
    rng = random.Random(14)
    for _ in range(200):
        n = rng.randint(2, 500)
        x, y = sorted(rng.sample(range(1, n + 1), 2))
        stream = [k for k in range(1, n + 1) if k not in (x, y)]
        rng.shuffle(stream)
        s = n * (n + 1) // 2 - sum(stream)
        q = n * (n + 1) * (2 * n + 1) // 6 - sum(k * k for k in stream)
        d = math.isqrt(2 * q - s * s)  # (x - y)^2 = 2q - s^2
        assert d * d == 2 * q - s * s
        assert ((s - d) // 2, (s + d) // 2) == (x, y)


@check("bt-numbers-008")
def _():
    return sum(sum(map(int, str(k))) for k in range(1, 10**6 + 1))


@check("bt-numbers-009")
def _():
    def ways(n):
        count = 0
        for start in range(1, n):
            total, k = 0, start
            while total < n:
                total += k
                k += 1
            if total == n and k - start >= 2:
                count += 1
        return count

    for n in range(1, 600):
        assert (ways(n) == 0) == (n & (n - 1) == 0), n
    odd_divisors = sum(1 for d in range(1, 2026, 2) if 2025 % d == 0)
    assert odd_divisors == 15 and ways(2025) == 14


@check("bt-numbers-010")
def _():
    gap, flown = 100.0, 0.0  # distance between trains; fly starts on one of them
    while gap > 1e-12:
        t = gap / (75 + 50)  # fly meets the oncoming train
        flown += 75 * t
        gap -= 100 * t
    return flown


# ================================================================ geometry


@check("bt-geometry-001")
def _():
    k = 4
    # inside radius r/k the duck's angular speed v/rho beats the fox's k v / r
    for rho in (0.1, 0.2, 0.249):
        assert 1 / rho > k
    # dash from radius r/k (r = 1): duck swims 1 - 1/k, fox runs half the shore at k times the speed
    assert (1 - 1 / k) < math.pi / k
    assert abs((1 + math.pi) - 4.14159) < 1e-5


@check("bt-geometry-002")
def _():
    R = 6371.0

    def walk(colat, lon):
        colat += 1 / R  # south
        lon += 1 / (R * math.sin(colat))  # east along the parallel
        colat -= 1 / R  # north
        return colat, lon % (2 * math.pi)

    for k in (1, 2, 5):
        circle = math.pi - math.asin(1 / (2 * math.pi * R * k))  # parallel of length 1/k km
        start = circle - 1 / R
        c, lon = walk(start, 0.3)
        assert abs(c - start) < 1e-12
        assert min(abs(lon - 0.3), 2 * math.pi - abs(lon - 0.3)) < 1e-6
    c, lon = walk(1.0, 0.3)  # an ordinary point does not return
    assert abs(lon - 0.3) > 1e-4


@check("bt-geometry-003")
def _():
    dims = (30.0, 20.0, 10.0)

    def ternary(f, lo, hi):
        for _ in range(200):
            m1, m2 = lo + (hi - lo) / 3, hi - (hi - lo) / 3
            if f(m1) < f(m2):
                hi = m2
            else:
                lo = m1
        return f((lo + hi) / 2)

    best = math.inf
    for i in range(3):  # start face: coordinate i is 0
        for j in range(3):  # end face: coordinate j is at its maximum
            if i == j:
                continue
            k = 3 - i - j
            di, dj, dk = dims[i], dims[j], dims[k]
            # cross the shared edge (coordinate i = 0, j = max) at height t along axis k
            length = lambda t: math.hypot(dj, t) + math.hypot(di, dk - t)  # noqa: E731
            best = min(best, ternary(length, 0.0, dk))
    return best


@check("bt-geometry-004")
def _():
    def shell_volume(R, half=3.0):
        # V = int_a^R 2 pi rho * 2 sqrt(R^2 - rho^2) drho with rho = R cos u (smooth integrand)
        a = math.sqrt(R * R - half * half)
        u_hi = math.acos(a / R)
        n = 2000
        h = u_hi / n
        f = lambda u: 4 * math.pi * R**3 * math.cos(u) * math.sin(u) ** 2  # noqa: E731
        s = f(0) + f(u_hi) + sum((4 if i % 2 else 2) * f(i * h) for i in range(1, n))
        return s * h / 3

    vols = [shell_volume(R) for R in (3.0, 4.0, 10.0, 100.0)]
    assert max(vols) - min(vols) < 1e-6 * vols[0]

    R = 5.0

    def trial(rng):
        x, y, z = (rng.uniform(-R, R) for _ in range(3))
        return (2 * R) ** 3 * (x * x + y * y + z * z <= R * R and x * x + y * y >= R * R - 9)

    mc = simulate(trial, n=200_000, seed=4)
    assert abs(mc.mean - vols[0]) < 4 * mc.stderr
    return vols[2]


@check("bt-geometry-005")
def _():
    extra = {name: 2 * math.pi * ((c / (2 * math.pi)) + 1) - c for name, c in (("earth", 4e7), ("ball", 0.7))}
    assert abs(extra["earth"] - extra["ball"]) < 1e-6
    assert abs(extra["ball"] - 6.283) < 1e-3
    return "c"


@check("bt-geometry-006")
def _():
    def regions(n):
        # n points in circular order; only their order matters for which chords cross
        chords = list(itertools.combinations(range(n), 2))

        def crosses(c1, c2):
            a, b = c1
            c, d = c2
            if len({a, b, c, d}) < 4:
                return False
            # chords of a convex polygon cross exactly when their endpoints interleave
            return (a < c < b) != (a < d < b)

        on_chord = Counter()
        inter = 0
        for c1, c2 in itertools.combinations(chords, 2):
            if crosses(c1, c2):
                inter += 1
                on_chord[c1] += 1
                on_chord[c2] += 1
        vertices = n + inter
        edges = n + sum(1 + on_chord[c] for c in chords)  # n arcs plus chord pieces
        return edges - vertices + 1 if n > 1 else 1

    got = [regions(n) for n in range(1, 7)]
    assert got == [1, 2, 4, 8, 16, 31]
    return "b"


# ================================================================ estimation


@check("bt-estimation-003")
def _():
    p, g, r = 101_325.0, 9.80665, 6.371e6
    return p * 4 * math.pi * r * r / g


@check("bt-estimation-005")
def _():
    return math.log(2) / math.log(1.06)
