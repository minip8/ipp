"""Regenerates tests.json deterministically from the Python reference solution.

A brute force (merge any two overlapping accounts until a fixed point) is checked against the
reference on small random inputs first. Results are compared as multisets of entries.
"""
import json, random, string, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


def brute(accounts):
    groups = [(a[0], set(a[1:])) for a in accounts]
    changed = True
    while changed:
        changed = False
        for i in range(len(groups)):
            for j in range(i + 1, len(groups)):
                if groups[i][1] & groups[j][1]:
                    groups[i] = (groups[i][0], groups[i][1] | groups[j][1])
                    groups.pop(j)
                    changed = True
                    break
            if changed:
                break
    return [[name] + sorted(emails) for name, emails in groups]


def canon(res):
    return sorted(json.dumps(r) for r in res)


def solve(accounts):
    return mod.Solution().accountsMerge([list(a) for a in accounts])


NAMES = ["Ana", "Ben", "Chen", "Dara", "Eli", "Fay", "Gus", "Hana", "Ivo", "Jon"]
DOMAINS = ["x.io", "mail.com", "work.net", "uni.edu"]


def gen(rng, n_people, n_accounts, emails_per_person, max_len=10, few_names=False):
    """People own disjoint email pools; each account picks a person and some of their emails.
    Accounts of the same person may or may not end up linked, which is the interesting part."""
    people = []
    used = set()
    for p in range(n_people):
        name = rng.choice(NAMES[:3] if few_names else NAMES)
        pool = []
        while len(pool) < emails_per_person:
            local = "".join(rng.choice(string.ascii_lowercase + string.digits + "._") for _ in range(rng.randint(1, 8)))
            local = rng.choice(string.ascii_lowercase) + local
            e = f"{local}@{rng.choice(DOMAINS)}"
            if e not in used:
                used.add(e); pool.append(e)
        people.append((name, pool))
    accounts = []
    for _ in range(n_accounts):
        name, pool = rng.choice(people)
        k = rng.randint(1, min(max_len - 1, len(pool)))
        emails = [rng.choice(pool) for _ in range(k)]  # may repeat
        accounts.append([name] + emails)
    return accounts


def case(id, hidden, accounts, explanation=None):
    t = {"id": id, "hidden": hidden, "ctorArgs": [],
         "calls": [{"method": "accountsMerge", "args": [accounts]}], "expected": [solve(accounts)]}
    if explanation: t["explanation"] = explanation
    return t


rng = random.Random(721)
for _ in range(300):
    acc = gen(rng, rng.randint(1, 4), rng.randint(1, 8), rng.randint(1, 6), few_names=True)
    assert canon(solve(acc)) == canon(brute(acc))

tests = [
    case("s1", False, [["Ana", "ana@x.io", "ana.k@mail.com"], ["Ben", "ben@y.org"],
                       ["Ana", "a.k@work.net", "ana@x.io"], ["Ana", "ana2@x.io"]],
         "Accounts 0 and 2 share ana@x.io; the last Ana shares nothing and stays separate."),
    case("s2", False, [["Kim", "k1@a.com", "k2@a.com"], ["Kim", "k3@a.com", "k4@a.com"], ["Kim", "k2@a.com", "k3@a.com"]],
         "The third account links the first two through different emails, so all three merge."),
    case("h-single", True, [["Zoe", "z@z.z"]]),
    case("h-dup-in-account", True, [["Max", "m@a.com", "m@a.com", "b@a.com", "m@a.com"]], "Duplicates must be removed."),
    case("h-same-name-distinct", True, [["Ann", "a@1.com"], ["Ann", "a@2.com"], ["Ann", "a@3.com"]],
         "Same name, no shared email: three different people."),
    case("h-identical-accounts", True, [["Lu", "l@q.io", "m@q.io"], ["Lu", "m@q.io", "l@q.io"]]),
    case("h-sort-bytewise", True, [["Pat", "b_x@a.com", "b.x@a.com", "bx@a.com", "b1@a.com", "B@a.com"]],
         "Plain byte-wise sort: '.' < '1' < 'B' < '_' < 'x'."),
    case("h-late-bridge", True, [["Q", "q1@a.io"], ["Q", "q2@a.io"], ["Q", "q3@a.io"], ["Q", "q4@a.io"],
                                 ["Q", "q1@a.io", "q2@a.io"], ["Q", "q3@a.io", "q4@a.io"], ["Q", "q2@a.io", "q3@a.io"]]),
]
for k, (p, a, e) in enumerate([(3, 6, 4), (5, 15, 5), (10, 40, 6), (20, 80, 8), (40, 200, 10)]):
    tests.append(case(f"h-rand-{k}", True, gen(rng, p, a, e, few_names=(k % 2 == 0))))
# Chain: account i holds e_i and e_{i+1}; everything merges into one person through a long chain.
chain = [["Rex", f"r{i}@c.io", f"r{i + 1}@c.io"] for i in range(1000)]
rng.shuffle(chain)
tests.append(case("h-long-chain", True, chain, "1000 accounts linked in a shuffled chain merge into one."))
tests.append(case("h-large", True, gen(rng, 150, 700, 12)))
tests.append(case("h-large-few-people", True, gen(rng, 8, 1000, 60, few_names=True)))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
