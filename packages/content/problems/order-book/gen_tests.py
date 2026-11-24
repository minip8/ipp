"""Regenerates tests.json deterministically from the Python reference solution.

Every operation sequence is replayed against a brute-force model (a flat list of resting orders,
re-sorted by price-time priority on every match) and the two must agree before anything is written.
"""
import json, random, importlib.util, pathlib

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("solution", here / "solution.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)


class Model:
    def __init__(self):
        self.book = []        # dicts: id, side, price, qty, t
        self.used = set()
        self.t = 0
        self.fills = []

    def _find(self, id):
        return next((o for o in self.book if o["id"] == id), None)

    def addOrder(self, id, side, price, qty):
        self.fills = []
        if price <= 0 or qty <= 0 or id in self.used:
            return -1
        self.used.add(id)
        rem = qty
        if side == "buy":
            cands = sorted((o for o in self.book if o["side"] == "sell" and o["price"] <= price),
                           key=lambda o: (o["price"], o["t"]))
        else:
            cands = sorted((o for o in self.book if o["side"] == "buy" and o["price"] >= price),
                           key=lambda o: (-o["price"], o["t"]))
        for o in cands:
            if rem == 0:
                break
            take = min(rem, o["qty"])
            rem -= take
            o["qty"] -= take
            self.fills.append([o["id"], o["price"], take])
        self.book = [o for o in self.book if o["qty"] > 0]
        if rem:
            self.t += 1
            self.book.append({"id": id, "side": side, "price": price, "qty": rem, "t": self.t})
        return qty - rem

    def cancel(self, id):
        o = self._find(id)
        if not o:
            return False
        self.book.remove(o)
        return True

    def modify(self, id, newQty):
        o = self._find(id)
        if not o or newQty <= 0:
            return False
        if newQty > o["qty"]:
            self.t += 1
            o["t"] = self.t
        o["qty"] = newQty
        return True

    def bestBid(self):
        return max((o["price"] for o in self.book if o["side"] == "buy"), default=-1)

    def bestAsk(self):
        return min((o["price"] for o in self.book if o["side"] == "sell"), default=-1)

    def volumeAt(self, side, price):
        return sum(o["qty"] for o in self.book if o["side"] == side and o["price"] == price)

    def lastFills(self):
        return [list(f) for f in self.fills]


def run(cls, ops):
    obj = cls()
    return [getattr(obj, m)(*a) for m, a in ops]


def case(id, hidden, ops, explanation=None):
    expected = run(mod.OrderBook, ops)
    assert expected == run(Model, ops), id
    t = {"id": id, "hidden": hidden, "ctorArgs": [],
         "calls": [{"method": m, "args": a} for m, a in ops], "expected": expected}
    if explanation: t["explanation"] = explanation
    return t


def random_ops(rng, n, mid=100, spread=5, max_qty=20, invalid=0.03):
    """Prices cluster around `mid` so books cross often; ids mostly fresh, sometimes reused."""
    ops, next_id, ids = [], 1, []
    for _ in range(n):
        r = rng.random()
        if r < 0.45:
            if rng.random() < invalid:
                choice = rng.random()
                if choice < 0.4 and ids:
                    ops.append(("addOrder", [rng.choice(ids), rng.choice(["buy", "sell"]), mid, 5]))
                elif choice < 0.7:
                    ops.append(("addOrder", [next_id, "buy", mid, rng.choice([0, -3])]))
                    next_id += 1
                else:
                    ops.append(("addOrder", [next_id, "sell", rng.choice([0, -1]), 5]))
                    next_id += 1
            else:
                side = rng.choice(["buy", "sell"])
                skew = 1 if side == "sell" else -1     # buys a bit below mid, sells a bit above
                price = max(1, mid + skew * rng.randint(-spread // 2, spread))
                ops.append(("addOrder", [next_id, side, price, rng.randint(1, max_qty)]))
                ids.append(next_id)
                next_id += 1
        elif r < 0.55:
            ops.append(("lastFills", []))
        elif r < 0.65 and ids:
            ops.append(("cancel", [rng.choice(ids) if rng.random() < 0.9 else next_id + 1000]))
        elif r < 0.73 and ids:
            ops.append(("modify", [rng.choice(ids), rng.choice([0, rng.randint(1, max_qty * 2)])]))
        elif r < 0.81:
            ops.append(("bestBid", []))
        elif r < 0.89:
            ops.append(("bestAsk", []))
        else:
            ops.append(("volumeAt", [rng.choice(["buy", "sell"]), mid + rng.randint(-spread, spread)]))
    return ops


A = lambda i, s, p, q: ("addOrder", [i, s, p, q])
C = lambda i: ("cancel", [i])
M = lambda i, q: ("modify", [i, q])
BB, BA, LF = ("bestBid", []), ("bestAsk", []), ("lastFills", [])
V = lambda s, p: ("volumeAt", [s, p])

rng = random.Random(2024)
for _ in range(300):
    ops = random_ops(rng, 80, spread=rng.randint(1, 6), max_qty=rng.randint(1, 10))
    assert run(mod.OrderBook, ops) == run(Model, ops)

tests = [
    case("s1", False, [A(1, "sell", 101, 5), A(2, "sell", 100, 3), A(3, "sell", 101, 4), A(4, "buy", 101, 10), LF, BA,
                       A(5, "buy", 99, 7), BB, A(4, "buy", 50, 1), M(5, 9), V("buy", 99), C(5), BB],
         "The buy takes the cheaper sell first, then the two sells at 101 oldest-first; id 4 cannot be reused."),
    case("s2", False, [A(10, "buy", 50, 4), A(11, "buy", 52, 2), A(12, "sell", 49, 5), LF, BB, V("buy", 50)],
         "The sell matches the highest bid (52) first and trades at the resting prices, not at 49."),
    case("s3", False, [A(1, "buy", 10, 5), A(2, "buy", 10, 5), M(1, 8), A(3, "sell", 10, 6), LF,
                       A(4, "buy", 10, 1), M(2, 1), C(4), C(4), A(5, "sell", 9, 3), LF],
         "Raising #1's quantity sends it behind #2. Reducing #2 keeps its place."),
    case("h-empty-book", True, [BB, BA, LF, V("buy", 1), C(1), M(1, 5)]),
    case("h-rejects", True, [A(1, "buy", 0, 5), A(2, "sell", 5, 0), A(3, "buy", -4, 1), A(4, "buy", 5, 1),
                             A(4, "sell", 5, 1), LF, BB, BA, A(2, "sell", 5, 1), LF],
         "Rejected orders do not consume their ids; a rejected order leaves lastFills empty."),
    case("h-reuse-filled-id", True, [A(1, "buy", 5, 2), A(2, "sell", 5, 2), BB, BA, A(1, "buy", 5, 1), A(2, "sell", 6, 1), BA],
         "Ids of fully filled orders stay used."),
    case("h-no-cross", True, [A(1, "buy", 99, 5), A(2, "sell", 100, 5), LF, BB, BA, A(3, "buy", 99, 1), A(4, "sell", 100, 1),
                              V("buy", 99), V("sell", 100)]),
    case("h-sweep-levels", True, [A(1, "sell", 101, 1), A(2, "sell", 102, 2), A(3, "sell", 103, 3), A(4, "sell", 104, 4),
                                  A(5, "buy", 103, 100), LF, BB, BA, V("buy", 103), V("sell", 104)],
         "A large buy sweeps three levels and the remainder rests at 103."),
    case("h-exact-fill", True, [A(1, "sell", 7, 3), A(2, "buy", 7, 3), LF, BB, BA, V("sell", 7), C(1), C(2)]),
    case("h-cancel-middle", True, [A(1, "buy", 20, 1), A(2, "buy", 20, 2), A(3, "buy", 20, 3), C(2), V("buy", 20),
                                   A(4, "sell", 20, 4), LF, V("buy", 20), C(3), BB]),
    case("h-modify-rules", True, [A(1, "sell", 30, 5), A(2, "sell", 30, 5), M(1, 5), M(2, 0), M(2, -1), M(9, 3),
                                  M(1, 6), A(3, "buy", 30, 7), LF, V("sell", 30)],
         "Modify to the same quantity keeps priority; only an increase loses it."),
    case("h-modify-does-not-trade", True, [A(1, "buy", 10, 1), A(2, "sell", 11, 1), M(1, 50), M(2, 50), LF, BB, BA]),
    case("h-lastfills-persist", True, [A(1, "sell", 5, 5), A(2, "buy", 5, 2), C(1), LF, A(3, "buy", 1, 1), LF]),
    case("h-level-reappears", True, [A(1, "buy", 40, 2), C(1), BB, A(2, "buy", 40, 3), BB, V("buy", 40), A(3, "sell", 40, 1), LF]),
]
for k, (n, spread, q) in enumerate([(60, 2, 5), (150, 4, 10), (300, 6, 20), (500, 10, 50), (800, 3, 3)]):
    tests.append(case(f"h-rand-{k}", True, random_ops(rng, n, spread=spread, max_qty=q)))
tests.append(case("h-deep-book", True, random_ops(rng, 2500, spread=40, max_qty=100)))
# Many small orders resting on one level, then one large order sweeps them all.
ops = [A(i, "sell", 500, 1) for i in range(1, 1501)] + [A(5000, "buy", 500, 1400), V("sell", 500), BA]
tests.append(case("h-long-queue", True, ops))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
