"""Regenerates tests.json deterministically.

There is no Python reference solution for this C++-only problem: expected values come from a
small model of the specified List semantics as seen through the harness (harness.cpp). Lists are
Python lists of element objects (identity = the node), iterator slots refer to an element or to
the end of one particular List object, and every Tracked copy and move is counted. Iterators to
an element follow it through splice, reverse and list moves; the generator only ever uses
iterators the statement says are still valid. Self copy-assignment may or may not copy (both are
allowed), so nothing that counts copies follows one.
"""
import json, random, pathlib

here = pathlib.Path(__file__).parent
LISTS = 4
ITERS = 8
MAX_CALLS = 2500


class E:
    def __init__(self, value):
        self.value = value


class LS:
    def __init__(self, items=None):
        self.items = list(items or [])


class Model:
    def __init__(self):
        self.lists = {}  # slot -> LS
        self.its = {}    # iterator slot -> ("e", E) | ("end", LS)
        self.n_copies = 0
        self.n_moves = 0

    # ---- helpers
    def _held(self, s):
        assert s in self.lists, f"list slot {s} holds no List"
        return self.lists[s]

    def owner(self, e):
        for ls in self.lists.values():
            if any(x is e for x in ls.items):
                return ls
        return None

    def valid(self, i):
        if i not in self.its:
            return False
        kind, x = self.its[i]
        if kind == "e":
            return self.owner(x) is not None
        return any(ls is x for ls in self.lists.values())

    def list_of(self, i):
        assert self.valid(i), f"iterator {i} is not valid"
        kind, x = self.its[i]
        return self.owner(x) if kind == "e" else x

    def slot_of(self, i):
        ls = self.list_of(i)
        return next(s for s, l in self.lists.items() if l is ls)

    def index(self, i):
        """Position of iterator i in its list (len for end())."""
        kind, x = self.its[i]
        ls = self.list_of(i)
        if kind == "end":
            return len(ls.items)
        return next(k for k, y in enumerate(ls.items) if y is x)

    def _at(self, ls, k):
        return ("e", ls.items[k]) if k < len(ls.items) else ("end", ls)

    def _count(self, move):
        if move:
            self.n_moves += 1
        else:
            self.n_copies += 1

    # ---- ops: each returns the harness method's result (None for void)
    def create(self, s):
        self.lists[s] = LS()

    def pushBack(self, s, v, move):
        self._count(move)
        self._held(s).items.append(E(v))

    def pushFront(self, s, v, move):
        self._count(move)
        self._held(s).items.insert(0, E(v))

    def popBack(self, s):
        self._held(s).items.pop()

    def popFront(self, s):
        self._held(s).items.pop(0)

    def front(self, s):
        return self._held(s).items[0].value

    def back(self, s):
        return self._held(s).items[-1].value

    def size(self, s):
        return len(self._held(s).items)

    def contents(self, s):
        return [e.value for e in self._held(s).items]

    def contentsReversed(self, s):
        return [e.value for e in reversed(self._held(s).items)]

    def clear(self, s):
        self._held(s).items.clear()

    def reverse(self, s):
        self._held(s).items.reverse()

    def itBegin(self, i, s):
        self.its[i] = self._at(self._held(s), 0)

    def itEnd(self, i, s):
        self.its[i] = ("end", self._held(s))

    def itNext(self, i):
        ls, k = self.list_of(i), self.index(i)
        assert k < len(ls.items), "++ on end()"
        self.its[i] = self._at(ls, k + 1)

    def itPrev(self, i):
        ls, k = self.list_of(i), self.index(i)
        assert k > 0, "-- on begin()"
        self.its[i] = self._at(ls, k - 1)

    def itPostNext(self, i):
        v = self.itGet(i)
        self.itNext(i)
        return v

    def itGet(self, i):
        assert self.valid(i)
        kind, x = self.its[i]
        assert kind == "e", "dereferencing end()"
        return x.value

    def itEq(self, i, j):
        assert self.valid(i) and self.valid(j)
        return self.its[i][0] == self.its[j][0] and self.its[i][1] is self.its[j][1]

    def itCopy(self, i, j):
        assert self.valid(i)
        self.its[j] = self.its[i]

    def insert(self, s, pos, v, move, out):
        ls = self._held(s)
        assert self.list_of(pos) is ls
        k = self.index(pos)
        self._count(move)
        e = E(v)
        ls.items.insert(k, e)
        self.its[out] = ("e", e)
        return v

    def emplace(self, s, pos, v, out):
        ls = self._held(s)
        assert self.list_of(pos) is ls
        e = E(v)
        ls.items.insert(self.index(pos), e)
        self.its[out] = ("e", e)
        return v

    def erase(self, s, pos, out):
        ls = self._held(s)
        assert self.list_of(pos) is ls and self.its[pos][0] == "e"
        k = self.index(pos)
        ls.items.pop(k)
        self.its[out] = self._at(ls, k)
        return ls.items[k].value if k < len(ls.items) else -1

    def splice(self, s, pos, other):
        assert s != other
        ls, lo = self._held(s), self._held(other)
        assert self.list_of(pos) is ls
        k = self.index(pos)
        ls.items[k:k] = lo.items
        lo.items = []

    def spliceOne(self, s, pos, other, it):
        ls, lo = self._held(s), self._held(other)
        assert self.list_of(pos) is ls and self.list_of(it) is lo and self.its[it][0] == "e"
        e = self.its[it][1]
        if ls is lo:
            ke, kp = self.index(it), self.index(pos)
            if kp == ke or kp == ke + 1:
                return  # already in place
        lo.items.remove(e)
        ls.items.insert(self.index(pos), e)

    def copyConstruct(self, a, b):
        assert a != b
        src = self._held(a)
        self.n_copies += len(src.items)
        self.lists[b] = LS(E(e.value) for e in src.items)

    def copyAssign(self, a, b):
        src, dst = self._held(a), self._held(b)
        if a == b:
            return
        self.n_copies += len(src.items)
        dst.items = [E(e.value) for e in src.items]

    def moveConstruct(self, a, b):
        assert a != b
        src = self._held(a)
        self.lists[b] = LS(src.items)
        src.items = []

    def moveAssign(self, a, b):
        src, dst = self._held(a), self._held(b)
        if a == b:
            return
        dst.items = src.items
        src.items = []

    def destroy(self, s):
        self._held(s)
        del self.lists[s]

    def destroyAll(self):
        self.lists.clear()

    def alive(self):
        return sum(len(ls.items) for ls in self.lists.values())

    def copies(self):
        return self.n_copies

    def moves(self):
        return self.n_moves

    def heapBlocks(self):
        return self.alive()

    def errors(self):
        return []


def case(id, hidden, ops, explanation=None, check_end=True):
    ops = list(ops)
    if check_end:
        ops += [("destroyAll", []), ("alive", []), ("heapBlocks", []), ("errors", [])]
    assert len(ops) <= MAX_CALLS, (id, len(ops))
    m = Model()
    expected = [getattr(m, name)(*args) for name, args in ops]
    t = {"id": id, "hidden": hidden, "ctorArgs": [],
         "calls": [{"method": n, "args": a} for n, a in ops], "expected": expected}
    if explanation:
        t["explanation"] = explanation
    return t


def op(name, *args):
    return (name, list(args))


PB = lambda s, v, move=True: op("pushBack", s, v, move)


def random_ops(rng, n, max_len=30):
    m = Model()
    ops = []
    nxt = [0]

    def fresh():
        nxt[0] += rng.randint(1, 9)
        return nxt[0]

    for s in range(LISTS):
        ops.append(op("create", s))
        m.create(s)
    while len(ops) < n:
        held = sorted(m.lists)
        valid = [i for i in range(ITERS) if m.valid(i)]
        elem = [i for i in valid if m.its[i][0] == "e"]
        not_begin = [i for i in valid if m.index(i) > 0]
        small = [s for s in held if len(m.lists[s].items) < max_len]
        nonempty = [s for s in held if m.lists[s].items]
        choices = ["size", "contents", "contentsReversed", "alive", "copies", "moves", "heapBlocks",
                   "itBegin", "itBegin", "itEnd", "create"]
        if small:
            choices += ["pushBack", "pushFront"] * 3
        if nonempty:
            choices += ["popBack", "popFront", "front", "back", "reverse"]
        if elem:
            choices += ["itNext"] * 3 + ["itGet"] * 2 + ["itPostNext", "erase", "erase", "spliceOne", "spliceOne"]
        if not_begin:
            choices += ["itPrev", "itPrev"]
        if [i for i in valid if m.slot_of(i) in small]:
            choices += ["insert", "insert", "emplace"]
        if len(valid) >= 2:
            choices += ["itEq", "itCopy"]
        if valid and len(held) >= 2:
            choices += ["splice"]
        if held:
            choices += ["copyConstruct", "copyAssign", "moveConstruct", "moveAssign", "clear"]
        c = rng.choice(choices)
        if c in ("pushBack", "pushFront"):
            o = op(c, rng.choice(small), fresh(), rng.random() < 0.5)
        elif c in ("popBack", "popFront", "front", "back", "reverse"):
            o = op(c, rng.choice(nonempty))
        elif c in ("size", "contents", "contentsReversed", "clear"):
            if c == "clear" and rng.random() < 0.7:
                continue
            o = op(c, rng.choice(held))
        elif c in ("itBegin", "itEnd"):
            o = op(c, rng.randrange(ITERS), rng.choice(held))
        elif c in ("itNext", "itGet", "itPostNext"):
            o = op(c, rng.choice(elem))
        elif c == "itPrev":
            o = op(c, rng.choice(not_begin))
        elif c == "itEq":
            o = op(c, rng.choice(valid), rng.choice(valid))
        elif c == "itCopy":
            o = op(c, rng.choice(valid), rng.randrange(ITERS))
        elif c in ("insert", "emplace"):
            pos = rng.choice([i for i in valid if m.slot_of(i) in small])
            out = rng.choice([pos, rng.randrange(ITERS)])
            if c == "insert":
                o = op(c, m.slot_of(pos), pos, fresh(), rng.random() < 0.5, out)
            else:
                o = op(c, m.slot_of(pos), pos, fresh(), out)
        elif c == "erase":
            pos = rng.choice(elem)
            o = op(c, m.slot_of(pos), pos, rng.choice([pos, rng.randrange(ITERS)]))
        elif c == "splice":
            pos = rng.choice(valid)
            s = m.slot_of(pos)
            others = [t for t in held if t != s]
            if not others:
                continue
            o = op(c, s, pos, rng.choice(others))
        elif c == "spliceOne":
            it = rng.choice(elem)
            pos = rng.choice(valid)
            o = op(c, m.slot_of(pos), pos, m.slot_of(it), it)
        elif c in ("copyConstruct", "moveConstruct"):
            a = rng.choice(held)
            o = op(c, a, rng.choice([t for t in range(LISTS) if t != a]))
        elif c in ("copyAssign", "moveAssign"):
            a, b = rng.choice(held), rng.choice(held)
            if c == "copyAssign" and a == b:
                continue  # self copy-assignment may or may not copy; tested on its own
            o = op(c, a, b)
        elif c == "create":
            o = op(c, rng.randrange(LISTS))
        else:
            o = op(c)
        getattr(m, o[0])(*o[1])
        ops.append(o)
    return ops


tests = [
    case("s1-basics", False, [
        op("create", 0), PB(0, 1), PB(0, 2, False), op("pushFront", 0, 0, True), op("contents", 0),
        op("contentsReversed", 0), op("front", 0), op("back", 0), op("size", 0), op("copies"), op("moves"),
        op("heapBlocks"), op("popFront", 0), op("popBack", 0), op("contents", 0), op("alive"), op("heapBlocks"),
    ], "push_back(T&&) and push_front(T&&) move their argument once, push_back(const T&) copies it once. "
       "Each element is one heap node; the sentinel is part of the List and is not allocated."),
    case("s2-iterators", False, [
        op("create", 0), PB(0, 10), PB(0, 20), PB(0, 30), op("itBegin", 0, 0), op("itGet", 0), op("itNext", 0),
        op("itGet", 0), op("itEnd", 1, 0), op("itPrev", 1), op("itGet", 1), op("insert", 0, 0, 15, True, 2),
        op("itGet", 0), op("contents", 0), op("erase", 0, 2, 3), op("itGet", 3), op("contents", 0),
        op("itPostNext", 0), op("itEq", 0, 1), op("emplace", 0, 1, 25, 4), op("contents", 0), op("copies"),
        op("moves"),
    ], "Iterators 0 and 1 point at 20 and 30. insert(it, 15) puts 15 before 20 and returns an iterator to it; "
       "it0 still points at 20. Erasing 15 returns an iterator to the next element (20). Postfix ++ returns "
       "the old position and moves it0 to 30. emplace builds 25 in place, before 30."),
    case("s3-splice-reverse", False, [
        op("create", 0), PB(0, 1), PB(0, 2), PB(0, 3), op("create", 1), PB(1, 7), PB(1, 8), op("itBegin", 0, 1),
        op("itNext", 0), op("itBegin", 1, 0), op("itNext", 1), op("splice", 1, 0, 0), op("contents", 1),
        op("size", 0), op("size", 1), op("itGet", 1), op("itBegin", 2, 1), op("spliceOne", 1, 2, 1, 1),
        op("contents", 1), op("reverse", 1), op("contents", 1), op("contentsReversed", 1), op("itGet", 1),
        op("copies"), op("moves"), op("heapBlocks"),
    ], "splice relinks nodes: list 0's elements move in front of 8 without being copied or moved, and "
       "iterator 1 still points at 2, now in list 1. Splicing one element moves 2 to the front of list 1. "
       "reverse relinks every node; iterators keep pointing at the same elements."),

    case("h-empty", True, [
        op("create", 0), op("size", 0), op("contents", 0), op("contentsReversed", 0), op("heapBlocks"),
        op("itBegin", 0, 0), op("itEnd", 1, 0), op("itEq", 0, 1), op("reverse", 0), op("clear", 0),
        op("contents", 0), op("copyConstruct", 0, 1), op("size", 1), op("moveConstruct", 1, 2), op("size", 2),
        op("splice", 0, 1, 2), op("size", 0), op("moveAssign", 2, 0), op("contents", 0), op("heapBlocks"),
    ], "An empty list's begin() equals end(); copying, moving, splicing and reversing empty lists work and "
       "allocate nothing."),
    case("h-push-counts", True, [
        op("create", 0), PB(0, 1, True), PB(0, 2, False), op("pushFront", 0, 3, True),
        op("pushFront", 0, 4, False), op("copies"), op("moves"), op("contents", 0), op("contentsReversed", 0),
        op("front", 0), op("back", 0), op("heapBlocks"), op("alive"),
    ]),
    case("h-insert-positions", True, [
        op("create", 0), PB(0, 5), op("itBegin", 0, 0), op("insert", 0, 0, 4, False, 1), op("itEnd", 2, 0),
        op("insert", 0, 2, 6, True, 3), op("contents", 0), op("itGet", 0), op("itGet", 1), op("itGet", 3),
        op("insert", 0, 0, 45, True, 0), op("itGet", 0), op("itNext", 0), op("itGet", 0), op("contents", 0),
        op("contentsReversed", 0), op("front", 0), op("back", 0), op("copies"), op("moves"), op("size", 0),
    ], "insert puts the new element before pos (at the front for begin(), at the back for end()) and "
       "returns an iterator to it; iterators to other elements stay valid."),
    case("h-emplace-forwards", True, [
        op("create", 0), op("itEnd", 0, 0), op("emplace", 0, 0, 1, 1), op("emplace", 0, 0, 2, 2),
        op("emplace", 0, 1, 3, 3), op("contents", 0), op("copies"), op("moves"), op("errors"),
    ], "emplace builds the element in place from its forwarded arguments: no copy, no move."),
    case("h-erase", True,
         [op("create", 0)] + [PB(0, k) for k in range(1, 7)] +
         [op("itBegin", 0, 0), op("itCopy", 0, 1), op("itNext", 1), op("itNext", 1), op("itEnd", 2, 0),
          op("itPrev", 2), op("erase", 0, 0, 0), op("itGet", 0), op("erase", 0, 2, 3), op("itEq", 3, 3),
          op("itEnd", 4, 0), op("itEq", 3, 4), op("contents", 0), op("itGet", 1), op("erase", 0, 1, 1),
          op("itGet", 1), op("contents", 0), op("contentsReversed", 0), op("size", 0), op("alive"),
          op("heapBlocks"), op("errors")],
         "erase returns an iterator to the element after the erased one (end() after the last); it destroys "
         "the element and frees its node, and every other iterator stays valid."),
    case("h-iterator-walk", True,
         [op("create", 0)] + [PB(0, 10 * k) for k in range(1, 9)] +
         [op("itBegin", 0, 0)] + [x for _ in range(4) for x in (op("itPostNext", 0),)] +
         [op("itGet", 0), op("itEnd", 1, 0)] + [x for _ in range(3) for x in (op("itPrev", 1), op("itGet", 1))] +
         [op("itEq", 0, 1), op("itPrev", 1), op("itEq", 0, 1), op("itCopy", 1, 2), op("itNext", 2),
          op("itEq", 1, 2), op("itGet", 2)],
         "Prefix and postfix ++, prefix --, and == behave as for any bidirectional iterator."),
    case("h-move-construct", True,
         [op("create", 0)] + [PB(0, k) for k in range(1, 6)] +
         [op("itBegin", 0, 0), op("itNext", 0), op("itEnd", 1, 0), op("itPrev", 1), op("itPrev", 1),
          op("moves"), op("moveConstruct", 0, 1), op("moves"), op("copies"), op("contents", 1),
          op("contentsReversed", 1), op("itGet", 0), op("itGet", 1), op("size", 0), op("size", 1),
          op("contents", 0), op("heapBlocks"), PB(0, 9), op("contents", 0), op("erase", 1, 0, 2),
          op("contents", 1), PB(1, 10), op("contentsReversed", 1)],
         "Moving a list relinks its nodes to the new list's sentinel: no element is touched, iterators to "
         "elements stay valid and now point into the new list, and the source is left empty and usable."),
    case("h-move-assign", True,
         [op("create", 0)] + [PB(0, k) for k in range(1, 4)] + [op("create", 1)] + [PB(1, k) for k in (7, 8)] +
         [op("itBegin", 0, 0), op("moveAssign", 0, 1), op("alive"), op("contents", 1), op("contentsReversed", 1),
          op("itGet", 0), op("size", 0), op("heapBlocks"), op("moves"), PB(1, 4), op("contents", 1),
          op("moveAssign", 1, 1), op("contents", 1), op("contentsReversed", 1), op("moveAssign", 0, 0),
          op("size", 0)],
         "Move assignment destroys the target's elements, takes over the source's nodes and leaves the source "
         "empty. l = std::move(l) leaves l unchanged."),
    case("h-copy", True,
         [op("create", 0)] + [PB(0, k) for k in range(1, 6)] +
         [op("copyConstruct", 0, 1), op("copies"), op("contents", 1), op("contentsReversed", 1),
          op("heapBlocks"), op("itBegin", 0, 1), op("erase", 1, 0, 0), PB(1, 6), op("contents", 0),
          op("contents", 1), op("create", 2), PB(2, 100), PB(2, 101), op("copyAssign", 0, 2), op("contents", 2),
          op("alive"), op("copies"), op("moves"), op("copyAssign", 0, 1), op("contents", 1),
          op("contentsReversed", 1)],
         "A copy copies each element once, in order, and is independent of the original. Copy assignment "
         "destroys the target's old elements."),
    case("h-self-copy-assign", True,
         [op("create", 0)] + [PB(0, k) for k in range(1, 5)] +
         [op("copyAssign", 0, 0), op("contents", 0), op("contentsReversed", 0), op("size", 0), op("alive"),
          op("heapBlocks"), op("errors")],
         "l = l must leave l unchanged."),
    case("h-splice-all", True,
         [op("create", 0), op("create", 1)] + [PB(0, k) for k in (1, 2)] + [PB(1, k) for k in (5, 6, 7)] +
         [op("itBegin", 0, 1), op("itBegin", 1, 0), op("itEnd", 2, 1), op("splice", 1, 0, 0), op("contents", 1),
          op("contentsReversed", 1), op("size", 0), op("size", 1), op("contents", 0), op("itGet", 1),
          op("itPrev", 2), op("itGet", 2), op("itEnd", 3, 0), op("splice", 0, 3, 1), op("contents", 0),
          op("size", 0), op("size", 1), op("itGet", 0), op("splice", 0, 0, 1), op("contents", 0),
          op("copies"), op("moves"), op("heapBlocks")],
         "splice(pos, other) moves all of other before pos in O(1), updating both sizes; splicing an empty "
         "list changes nothing."),
    case("h-splice-one-between", True,
         [op("create", 0), op("create", 1)] + [PB(0, k) for k in (1, 2, 3)] + [PB(1, k) for k in (8, 9)] +
         [op("itBegin", 0, 0), op("itNext", 0), op("itBegin", 1, 1), op("spliceOne", 1, 1, 0, 0),
          op("contents", 0), op("contents", 1), op("size", 0), op("size", 1), op("itGet", 0), op("itEnd", 2, 1),
          op("itBegin", 3, 0), op("spliceOne", 1, 2, 0, 3), op("contents", 1), op("contentsReversed", 1),
          op("contents", 0), op("front", 0), op("back", 1), op("copies"), op("moves"), op("heapBlocks")]),
    case("h-splice-one-same-list", True,
         [op("create", 0)] + [PB(0, k) for k in range(1, 6)] +
         [op("itBegin", 0, 0), op("itNext", 0), op("itNext", 0), op("itCopy", 0, 1), op("spliceOne", 0, 1, 0, 0),
          op("contents", 0), op("itNext", 1), op("spliceOne", 0, 1, 0, 0), op("contents", 0),
          op("contentsReversed", 0), op("itBegin", 2, 0), op("spliceOne", 0, 2, 0, 0), op("contents", 0),
          op("itEnd", 3, 0), op("spliceOne", 0, 3, 0, 2), op("contents", 0), op("contentsReversed", 0),
          op("size", 0), op("itGet", 0), op("itGet", 2), op("front", 0), op("back", 0)],
         "Splicing an element of the same list before itself, or before the element right after it, is a "
         "no-op; elsewhere it relinks the node. The size does not change."),
    case("h-reverse", True,
         [op("create", 0), op("reverse", 0), op("contents", 0), PB(0, 1), op("reverse", 0), op("contents", 0),
          op("contentsReversed", 0)] + [PB(0, k) for k in range(2, 7)] +
         [op("itBegin", 0, 0), op("itEnd", 1, 0), op("itPrev", 1), op("reverse", 0), op("contents", 0),
          op("contentsReversed", 0), op("itGet", 0), op("itGet", 1), op("front", 0), op("back", 0),
          op("itNext", 1), op("itGet", 1), op("reverse", 0), op("reverse", 0), op("contents", 0),
          op("copies"), op("moves"), op("heapBlocks")],
         "reverse relinks the nodes in O(n) without touching any element; iterators keep pointing at the same "
         "elements."),
    case("h-clear", True,
         [op("create", 0)] + [PB(0, k) for k in range(1, 9)] +
         [op("clear", 0), op("size", 0), op("alive"), op("heapBlocks"), op("contents", 0), op("contentsReversed", 0),
          PB(0, 9), op("pushFront", 0, 8, False), op("contents", 0), op("clear", 0), op("clear", 0), op("size", 0)],
         "clear destroys every element and frees every node; the list is then empty and reusable."),
    case("h-destructor", True,
         [op("create", 0)] + [PB(0, k) for k in range(1, 6)] + [op("create", 1), PB(1, 9)] +
         [op("alive"), op("heapBlocks"), op("destroy", 0), op("alive"), op("heapBlocks"), op("create", 1),
          op("alive"), op("heapBlocks"), op("errors")],
         "The destructor destroys each element exactly once and frees each node.", check_end=False),
    case("h-pop-to-empty", True,
         [op("create", 0)] + [PB(0, k) for k in range(1, 5)] +
         [op("popFront", 0), op("popBack", 0), op("front", 0), op("back", 0), op("popBack", 0), op("front", 0),
          op("back", 0), op("popFront", 0), op("size", 0), op("contents", 0), op("contentsReversed", 0),
          op("itBegin", 0, 0), op("itEnd", 1, 0), op("itEq", 0, 1), op("pushFront", 0, 7, True),
          op("contents", 0), op("heapBlocks")]),
    case("h-large", True,
         [op("create", 0)] + [PB(0, k, k % 2 == 0) for k in range(1200)] +
         [op("size", 0), op("copies"), op("moves"), op("reverse", 0), op("front", 0), op("back", 0),
          op("copyConstruct", 0, 1), op("copies"), op("itBegin", 0, 0), op("splice", 0, 0, 1), op("size", 0),
          op("size", 1), op("heapBlocks")] + [op("popFront", 0) for _ in range(600)] +
         [op("popBack", 0) for _ in range(600)] +
         [op("front", 0), op("back", 0), op("size", 0), op("alive")]),
]
rng = random.Random(1990)
for k, n in enumerate([40, 60, 100, 150, 250, 400, 600]):
    tests.append(case(f"h-rand-{k}", True, random_ops(rng, n)))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
