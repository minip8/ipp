"""Regenerates tests.json deterministically from the Python reference solution.

Every operation sequence is replayed against a brute-force model (one global tweet list scanned
backwards) and the two must agree before anything is written.
"""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


class Model:
    def __init__(self):
        self.all, self.f = [], set()

    def postTweet(self, u, t):
        self.all.append((u, t))

    def getNewsFeed(self, u):
        out = []
        for a, t in reversed(self.all):
            if a == u or (u, a) in self.f:
                out.append(t)
                if len(out) == 10:
                    break
        return out

    def follow(self, a, b):
        if a != b:
            self.f.add((a, b))

    def unfollow(self, a, b):
        self.f.discard((a, b))


def run(cls, ops):
    obj = cls()
    return [getattr(obj, m)(*a) for m, a in ops]


def case(id, hidden, ops, explanation=None):
    expected = run(mod.Twitter, ops)
    assert expected == run(Model, ops), id
    t = {"id": id, "hidden": hidden, "ctorArgs": [],
         "calls": [{"method": m, "args": a} for m, a in ops], "expected": expected}
    if explanation: t["explanation"] = explanation
    return t


def random_ops(rng, n, users, post=0.35, feed=0.3, fol=0.22):
    ids = rng.sample(range(10**6 + 1), n)     # distinct, not monotonic in time
    ops = []
    for i in range(n):
        r = rng.random()
        u = rng.randint(1, users)
        if r < post:
            ops.append(("postTweet", [u, ids[i]]))
        elif r < post + feed:
            ops.append(("getNewsFeed", [u]))
        elif r < post + feed + fol:
            ops.append(("follow", [u, rng.randint(1, users)]))
        else:
            ops.append(("unfollow", [u, rng.randint(1, users)]))
    return ops


P = lambda u, t: ("postTweet", [u, t])
F = lambda u: ("getNewsFeed", [u])
FO = lambda a, b: ("follow", [a, b])
UN = lambda a, b: ("unfollow", [a, b])
rng = random.Random(355)
for _ in range(300):
    ops = random_ops(rng, 80, rng.randint(1, 5))
    assert run(mod.Twitter, ops) == run(Model, ops)

tests = [
    case("s1", False, [P(1, 501), F(1), FO(1, 2), P(2, 77), P(1, 900), F(1), F(2), UN(1, 2), F(1)],
         "Feeds are ordered by posting time, most recent first; following is one-directional."),
    case("s2", False, [P(1, i) for i in range(12)] + [F(1), F(3)],
         "Only the 10 most recent tweets are returned; a user with no activity has an empty feed."),
    case("h-ids-not-time", True, [P(1, 1000), P(2, 5), P(1, 3), FO(1, 2), F(1)],
         "Tweet ids are not timestamps: 3 was posted last and comes first."),
    case("h-self-follow", True, [P(4, 1), FO(4, 4), F(4), UN(4, 4), F(4)],
         "Self-follow must not duplicate tweets; self-unfollow must not hide them."),
    case("h-double-follow", True, [P(2, 10), FO(1, 2), FO(1, 2), F(1), UN(1, 2), F(1), UN(1, 2), F(1)]),
    case("h-old-tweets-after-follow", True, [P(2, 1), P(2, 2), P(3, 3), FO(1, 2), F(1), FO(1, 3), F(1)],
         "Tweets posted before the follow still appear."),
    case("h-unfollow-stranger", True, [UN(1, 2), P(1, 7), F(1), F(2)]),
    case("h-many-followees", True, [FO(1, u) for u in range(2, 40)] + [P(u, 1000 + u) for u in range(2, 40)] + [F(1)]),
    case("h-interleaved-merge", True,
         [FO(1, 2), FO(1, 3)] + [P(1 + i % 3, 7000 - i * 13) for i in range(25)] + [F(1), F(2), F(3)]),
]
for k, (n, users) in enumerate([(50, 2), (120, 3), (300, 6), (600, 15), (500, 1), (700, 40)]):
    tests.append(case(f"h-rand-{k}", True, random_ops(rng, n, users)))
# Large: many users with long histories; feeds of users following many others.
ops = []
tid = iter(rng.sample(range(10**6 + 1), 4000))
for u in range(1, 101):
    for v in rng.sample(range(1, 101), 15):
        ops.append(FO(u, v))
for _ in range(1200):
    ops.append(P(rng.randint(1, 100), next(tid)))
ops += [F(rng.randint(1, 100)) for _ in range(250)]
tests.append(case("h-large", True, ops))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
