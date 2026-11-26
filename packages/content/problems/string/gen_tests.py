"""Regenerates tests.json deterministically.

There is no Python reference solution for this C++-only problem: expected values come from a
small model of the specified String semantics as seen through the harness (harness.cpp). A slot
holds its characters and its capacity. Construction allocates exactly the characters it holds;
growth makes the capacity max(2 * capacity, needed); reserve(n) reallocates to exactly n when
n > capacity; a moved-from String is empty with capacity 0; a String owns one heap block exactly
when its capacity is positive. After a copy assignment the target's capacity is unspecified, so
the model marks it unknown and the generator avoids anything that depends on it (capacity,
growth on that slot, and heapBlocks while an empty slot has unknown capacity).
"""
import json, random, pathlib

here = pathlib.Path(__file__).parent
SLOTS = 4
MAX_CALLS = 1500
NPOS = (1 << 64) - 1


def shown(cs):
    return "".join("_" if c == "\0" else c for c in cs)


class Model:
    def __init__(self):
        self.slots = {}  # slot -> [chars (list of 1-char str), capacity or None]
        self.allocs = 0  # None once it depends on an unspecified capacity

    def _held(self, s):
        assert s in self.slots, f"slot {s} holds no String"
        return self.slots[s]

    def _new(self, s, chars):
        self.slots[s] = [list(chars), len(chars)]
        if chars and self.allocs is not None:
            self.allocs += 1

    def _grow(self, s, extra):
        v = self._held(s)
        need = len(v[0]) + extra
        if v[1] is None:
            self.allocs = None  # whether it reallocates depends on the unknown capacity
            return
        if need > v[1]:
            v[1] = max(2 * v[1], need)
            if self.allocs is not None:
                self.allocs += 1

    def _append(self, s, chars):
        chars = list(chars)
        if not chars:
            return
        self._grow(s, len(chars))
        self.slots[s][0] += chars

    def create(self, s, text):
        self._new(s, text)

    def createEmpty(self, s):
        self._new(s, "")

    def createFill(self, s, n, ch):
        self._new(s, ch * n)

    def pushBack(self, s, ch):
        self._append(s, ch)

    def pushNul(self, s):
        self._append(s, "\0")

    def append(self, s, text):
        self._append(s, text)

    def appendString(self, a, b):
        self._append(b, list(self._held(a)[0]))

    def appendSuffix(self, s, pos):
        cs = self._held(s)[0][pos:]
        if "\0" in cs:
            cs = cs[: cs.index("\0")]  # a C string ends at the first '\0'
        self._append(s, cs)

    def plusEquals(self, a, b):
        self.appendString(a, b)

    def reserve(self, s, n):
        v = self._held(s)
        if v[1] is None:
            self.allocs = None
            return
        if n > v[1]:
            v[1] = n
            if self.allocs is not None:
                self.allocs += 1

    def clear(self, s):
        self._held(s)[0].clear()

    def size(self, s):
        return len(self._held(s)[0])

    def capacity(self, s):
        c = self._held(s)[1]
        assert c is not None, "capacity is unspecified here"
        return c

    def str(self, s):
        return shown(self._held(s)[0])

    def charAt(self, s, i):
        cs = self._held(s)[0]
        assert 0 <= i < len(cs)
        return shown(cs[i])

    def setChar(self, s, i, ch):
        cs = self._held(s)[0]
        assert 0 <= i < len(cs)
        cs[i] = ch

    def copyConstruct(self, a, b):
        assert a != b
        self._new(b, list(self._held(a)[0]))

    def copyAssign(self, a, b):
        va = self._held(a)
        self._held(b)
        # Whether it allocates (reuse vs copy-and-swap) and the capacity afterwards are up to the
        # candidate; the contents are not. s = s leaves the contents unchanged.
        self.allocs = None
        self.slots[b] = [list(va[0]), None]

    def moveConstruct(self, a, b):
        assert a != b
        v = self._held(a)
        self.slots[b] = [v[0], v[1]]
        self.slots[a] = [[], 0]

    def moveAssign(self, a, b):
        va, vb = self._held(a), self._held(b)
        if a == b:
            return
        self.slots[b] = [va[0], va[1]]
        self.slots[a] = [[], 0]

    def destroy(self, s):
        self._held(s)
        del self.slots[s]

    def destroyAll(self):
        self.slots.clear()

    def compare(self, a, b):
        x, y = self._held(a)[0], self._held(b)[0]
        return -1 if x < y else 1 if y < x else 0

    def substr(self, s, pos, count):
        cs = self._held(s)[0]
        if pos > len(cs):
            return "!out_of_range"
        cnt = count if count >= 0 else (1 << 64) + count
        part = cs[pos : pos + min(cnt, len(cs) - pos)]
        if part and self.allocs is not None:
            self.allocs += 1
        return shown(part)

    def find(self, a, b, pos):
        hay, needle = self._held(a)[0], self._held(b)[0]
        if pos > len(hay) or len(needle) > len(hay) - pos:
            return -1
        for i in range(pos, len(hay) - len(needle) + 1):
            if hay[i : i + len(needle)] == needle:
                return i
        return -1

    def allocations(self):
        assert self.allocs is not None, "allocation count is unspecified here"
        return self.allocs

    def heapBlocks(self):
        n = 0
        for chars, cap in self.slots.values():
            if cap is None:
                assert chars, "heapBlocks is unspecified while an empty slot has unknown capacity"
                n += 1
            elif cap > 0:
                n += 1
        return n

    def errors(self):
        return []


def case(id, hidden, ops, explanation=None, check_end=True):
    ops = list(ops)
    if check_end:
        ops += [("destroyAll", []), ("heapBlocks", []), ("errors", [])]
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


ALPHA = "abcdefghijklmnopqrstuvwxyz0123456789"


def word(rng, lo=0, hi=12, alphabet=ALPHA):
    return "".join(rng.choice(alphabet) for _ in range(rng.randint(lo, hi)))


def random_ops(rng, n, max_len=60, alphabet="abc"):
    """Random operations over four slots; never depends on an unspecified capacity."""
    m = Model()
    ops = []
    for s in range(SLOTS):
        o = op("create", s, word(rng, 0, 6, alphabet))
        getattr(m, o[0])(*o[1])
        ops.append(o)
    while len(ops) < n:
        held = sorted(m.slots)
        known = [s for s in held if m.slots[s][1] is not None]
        small = [s for s in known if len(m.slots[s][0]) < max_len]
        nonempty = [s for s in held if m.slots[s][0]]
        choices = ["str", "size", "compare", "find", "substr", "create", "createEmpty", "createFill"]
        if small:
            choices += ["pushBack", "append", "appendString", "plusEquals", "reserve", "capacity",
                        "appendSuffix", "pushNul"] * 2
        if nonempty:
            choices += ["setChar", "charAt"]
        choices += ["copyConstruct", "copyAssign", "moveConstruct", "moveAssign", "clear"]
        if m.allocs is not None:
            choices += ["allocations"]
        if all(c is not None or chars for chars, c in m.slots.values()):
            choices += ["heapBlocks"]
        c = rng.choice(choices)
        if c in ("pushBack",):
            o = op(c, rng.choice(small), rng.choice(alphabet))
        elif c == "pushNul":
            o = op(c, rng.choice(small))
        elif c == "append":
            o = op(c, rng.choice(small), word(rng, 0, 8, alphabet))
        elif c in ("appendString", "plusEquals"):
            b = rng.choice(small)
            a = rng.choice([s for s in held if len(m.slots[s][0]) + len(m.slots[b][0]) <= 2 * max_len] or [b])
            o = op(c, a, b)
        elif c == "appendSuffix":
            s = rng.choice(small)
            o = op(c, s, rng.randint(0, len(m.slots[s][0])))
        elif c == "reserve":
            o = op(c, rng.choice(small), rng.randint(0, max_len))
        elif c == "capacity":
            o = op(c, rng.choice(known))
        elif c in ("setChar", "charAt"):
            s = rng.choice(nonempty)
            i = rng.randrange(len(m.slots[s][0]))
            o = op(c, s, i, rng.choice(alphabet)) if c == "setChar" else op(c, s, i)
        elif c in ("create",):
            o = op(c, rng.randrange(SLOTS), word(rng, 0, 10, alphabet))
        elif c == "createEmpty":
            o = op(c, rng.randrange(SLOTS))
        elif c == "createFill":
            o = op(c, rng.randrange(SLOTS), rng.randint(0, 6), rng.choice(alphabet))
        elif c in ("copyConstruct", "moveConstruct"):
            a = rng.choice(held)
            o = op(c, a, rng.choice([s for s in range(SLOTS) if s != a]))
        elif c in ("copyAssign", "moveAssign"):
            a, b = rng.choice(held), rng.choice(held)
            if a == b:
                continue  # self-assignment is tested separately
            o = op(c, a, b)
        elif c in ("str", "size", "clear"):
            o = op(c, rng.choice(held))
        elif c == "compare":
            o = op(c, rng.choice(held), rng.choice(held))
        elif c == "find":
            a, b = rng.choice(held), rng.choice(held)
            o = op(c, a, b, rng.randint(0, len(m.slots[a][0]) + 1))
        elif c == "substr":
            s = rng.choice(held)
            L = len(m.slots[s][0])
            o = op(c, s, rng.randint(0, L + 1), rng.choice([-1, rng.randint(0, L + 2)]))
        else:
            o = op(c)
        getattr(m, o[0])(*o[1])
        ops.append(o)
    return ops


S = lambda *a: op("str", *a)
C = lambda *a: op("capacity", *a)

tests = [
    case("s1-growth", False, [
        op("createEmpty", 0), op("size", 0), op("capacity", 0), op("str", 0), op("allocations"),
        op("pushBack", 0, "a"), C(0), op("pushBack", 0, "b"), C(0), op("pushBack", 0, "c"), C(0),
        op("append", 0, "defgh"), C(0), op("append", 0, "ij"), C(0), S(0), op("size", 0),
        op("allocations"), op("heapBlocks"),
    ], "An empty String has capacity 0 and allocates nothing, yet c_str() is \"\". Capacity grows "
       "0 -> 1 -> 2 -> 4; appending 5 characters to 3 needs 8 = max(2 * 4, 8); appending 2 more needs "
       "10 > 8, so the capacity becomes max(16, 10) = 16. One allocation per growth: 5."),
    case("s2-copy-and-move", False, [
        op("create", 0, "hello"), C(0), op("allocations"), op("copyConstruct", 0, 1), op("allocations"),
        op("setChar", 1, 0, "j"), S(0), S(1), op("moveConstruct", 1, 2), op("allocations"), S(1),
        op("size", 1), C(1), S(2), op("heapBlocks"), op("compare", 0, 2), op("compare", 2, 0),
    ], "String(\"hello\") allocates exactly 5 characters (plus the '\\0'). A copy has its own buffer, so "
       "changing it leaves the original alone. Moving takes the buffer: no allocation, and the source "
       "is left empty with capacity 0."),
    case("s3-substr-find", False, [
        op("create", 0, "interview"), op("create", 1, "view"), op("find", 0, 1, 0), op("find", 0, 1, 6),
        op("create", 2, "er"), op("find", 0, 2, 0), op("find", 0, 2, 4), op("substr", 0, 5, -1),
        op("substr", 0, 0, 5), op("substr", 0, 9, 3), op("substr", 0, 10, 1),
    ], "find returns the first match at or after pos, or npos (-1). substr(pos, npos) runs to the "
       "end; substr(size(), n) is \"\"; pos > size() throws std::out_of_range."),

    # ---- construction and the empty state
    case("h-empty", True, [
        op("createEmpty", 0), op("str", 0), op("size", 0), op("capacity", 0), op("heapBlocks"),
        op("create", 1, ""), op("str", 1), op("capacity", 1), op("createFill", 2, 0, "x"), op("str", 2),
        op("capacity", 2), op("copyConstruct", 0, 3), op("str", 3), op("capacity", 3),
        op("allocations"), op("heapBlocks"), op("moveConstruct", 3, 0), op("moveAssign", 0, 1),
        op("str", 1), op("allocations"), op("errors"),
    ], "No String with capacity 0 allocates; c_str() of every empty String is a valid \"\"."),
    case("h-construct-exact", True, [
        op("create", 0, "abcdefghijklmnopq"), op("size", 0), C(0), op("str", 0), op("allocations"),
        op("createFill", 1, 7, "z"), op("str", 1), C(1), op("allocations"), op("heapBlocks"),
        op("create", 2, "x"), C(2), op("pushBack", 2, "y"), C(2), op("str", 2), op("allocations"),
        op("charAt", 0, 16), op("charAt", 1, 0), op("errors"),
    ], "String(s) and String(count, ch) allocate exactly the characters they hold."),
    case("h-terminator", True, [
        op("create", 0, "abcdef"), op("clear", 0), op("str", 0), op("size", 0), C(0), op("pushBack", 0, "x"),
        op("str", 0), op("reserve", 0, 20), op("str", 0), op("append", 0, "yz"), op("str", 0),
        op("createFill", 1, 3, "q"), op("str", 1), op("pushBack", 1, "r"), op("str", 1), op("errors"),
    ], "c_str()[size()] is '\\0' after every operation (clear, push_back, reserve, append, String(n, ch))."),
    case("h-buffer-size", True, [
        op("create", 0, "abc"), op("str", 0), op("reserve", 0, 9), op("append", 0, "defghi"), op("str", 0),
        op("createFill", 1, 5, "k"), op("str", 1), op("createEmpty", 2), op("pushBack", 2, "a"), op("str", 2),
        op("errors"),
    ], "Each buffer holds capacity() + 1 bytes: the characters plus the terminating '\\0'."),

    # ---- growth policy
    case("h-growth-push", True,
         [op("createEmpty", 0)] + [x for k in range(40) for x in (op("pushBack", 0, ALPHA[k % 36]), C(0))] +
         [op("allocations"), op("size", 0), op("heapBlocks")],
         "Capacity doubles: 1, 2, 4, 8, 16, 32, 64; 7 allocations for 40 push_backs."),
    case("h-growth-append", True, [
        op("create", 0, "ab"), op("append", 0, "c"), C(0), op("append", 0, "defghijkl"), C(0),
        op("append", 0, "m"), C(0), op("append", 0, ""), C(0), op("append", 0, "nopqrstuvwxyz0123456789"),
        C(0), op("str", 0), op("allocations"),
    ], "The new capacity is max(2 * capacity(), size() + n): 2 -> 4 -> 12 -> 24 -> 48."),
    case("h-growth-big-first", True, [
        op("createEmpty", 0), op("append", 0, "abcdefghij"), C(0), op("pushBack", 0, "k"), C(0),
        op("allocations"),
    ], "From capacity 0, appending 10 characters needs exactly 10."),
    case("h-reserve", True, [
        op("create", 0, "abc"), op("reserve", 0, 2), C(0), op("reserve", 0, 3), C(0), op("allocations"),
        op("reserve", 0, 10), C(0), op("reserve", 0, 5), C(0), op("str", 0), op("allocations"),
        op("append", 0, "defghij"), C(0),
        op("allocations"), op("pushBack", 0, "k"), C(0), op("reserve", 0, 5), C(0), op("str", 0),
        op("createEmpty", 1), op("reserve", 1, 0), C(1), op("heapBlocks"), op("reserve", 1, 4), C(1),
        op("str", 1), op("heapBlocks"), op("allocations"),
    ], "reserve(n) reallocates to exactly n only when n > capacity() and never shrinks. Filling the "
       "reserved space does not allocate."),
    case("h-clear-keeps-buffer", True, [
        op("create", 0, "abcdefgh"), op("clear", 0), C(0), op("size", 0), op("heapBlocks"),
        op("append", 0, "xyz"), op("allocations"), op("str", 0), op("clear", 0), op("clear", 0), op("str", 0),
    ], "clear() keeps the buffer and the capacity."),

    # ---- copy and move
    case("h-deep-copy", True, [
        op("create", 0, "abcdef"), op("reserve", 0, 20), op("copyConstruct", 0, 1), C(1), op("allocations"),
        op("setChar", 0, 0, "z"), op("setChar", 1, 5, "q"), S(0), S(1), op("pushBack", 1, "g"), S(0), S(1),
        op("destroy", 0), S(1), op("heapBlocks"), op("errors"),
    ], "A copy owns its own buffer of exactly size() characters (not the source's capacity)."),
    case("h-copy-assign", True, [
        op("create", 0, "short"), op("create", 1, "a much longer string"), op("copyAssign", 1, 0), S(0),
        op("size", 0), op("copyAssign", 0, 1), S(1), op("create", 2, "xy"), op("copyAssign", 2, 0), S(0),
        op("size", 0), op("setChar", 0, 0, "Q"), S(0), S(2), op("createEmpty", 3), op("copyAssign", 3, 1),
        S(1), op("size", 1), S(3), op("pushBack", 3, "w"), S(3), S(1), op("errors"),
    ], "After a = b, a holds its own copy of b's characters, whether it had more or fewer before."),
    case("h-self-copy-assign", True, [
        op("create", 0, "selfsame"), op("copyAssign", 0, 0), S(0), op("size", 0), op("heapBlocks"),
        op("createEmpty", 1), op("copyAssign", 1, 1), S(1), op("errors"),
    ], "s = s leaves s unchanged."),
    case("h-move-assign", True, [
        op("create", 0, "source"), op("create", 1, "target string"), op("allocations"), op("moveAssign", 0, 1),
        S(1), C(1), S(0), op("size", 0), C(0), op("heapBlocks"), op("allocations"), op("pushBack", 0, "n"),
        S(0), C(0), op("errors"),
    ], "Move assignment frees the target's buffer, takes the source's without allocating, and leaves "
       "the source empty with capacity 0 and still usable."),
    case("h-self-move-assign", True, [
        op("create", 0, "stays"), op("moveAssign", 0, 0), S(0), C(0), op("heapBlocks"), op("allocations"),
        op("createEmpty", 1), op("moveAssign", 1, 1), S(1), op("errors"),
    ], "s = std::move(s) leaves s unchanged."),
    case("h-moved-from-reusable", True, [
        op("create", 0, "abc"), op("moveConstruct", 0, 1), S(0), op("str", 0), op("append", 0, "def"), S(0),
        C(0), op("moveAssign", 1, 0), S(0), S(1), op("pushBack", 1, "z"), S(1), C(1), op("copyConstruct", 1, 2),
        S(2), op("allocations"),
    ], "A moved-from String is empty, has capacity 0, and is fully usable."),
    case("h-destructor", True, [
        op("create", 0, "one"), op("create", 1, "two"), op("createEmpty", 2), op("heapBlocks"), op("destroy", 0),
        op("heapBlocks"), op("destroy", 2), op("heapBlocks"), op("create", 1, "replaced"), op("heapBlocks"),
        op("destroy", 1), op("heapBlocks"), op("errors"),
    ], "The destructor frees the buffer exactly once.", check_end=False),

    # ---- embedded '\0'
    case("h-embedded-nul", True, [
        op("create", 0, "ab"), op("pushNul", 0), op("append", 0, "cd"), op("size", 0), S(0),
        op("copyConstruct", 0, 1), S(1), op("size", 1), op("create", 2, "x"), op("appendString", 0, 2), S(2),
        op("size", 2), op("create", 3, "ab"), op("compare", 0, 3), op("compare", 3, 0), op("compare", 0, 1),
        op("pushNul", 3), op("compare", 0, 3), op("compare", 3, 0), op("copyAssign", 0, 3), S(3),
        op("compare", 0, 3), op("errors"),
    ], "A String may hold '\\0' characters (shown as _): size() counts them, and copying, appending a "
       "String and comparing use all size() characters, not strlen or strcmp."),
    case("h-embedded-nul-find-substr", True, [
        op("create", 0, "x"), op("pushNul", 0), op("append", 0, "yx"), op("pushNul", 0), op("append", 0, "z"),
        op("create", 1, "x"), op("pushNul", 1), op("append", 1, "z"), op("find", 0, 1, 0), op("substr", 0, 1, 3),
        op("createEmpty", 2), op("pushNul", 2), op("find", 0, 2, 0), op("find", 0, 2, 2), op("find", 0, 2, 5),
        op("appendSuffix", 0, 3), S(0),
    ], "find and substr also see past a '\\0'; append(const char*) stops at the first '\\0'."),

    # ---- aliasing
    case("h-self-append", True, [
        op("create", 0, "abc"), C(0), op("appendString", 0, 0), S(0), C(0), op("appendString", 0, 0), S(0),
        C(0), op("plusEquals", 0, 0), S(0), op("size", 0), op("allocations"), op("errors"),
    ], "s.append(s) and s += s work even when they reallocate: the old characters must be read "
       "before the old buffer is freed."),
    case("h-self-append-fits", True, [
        op("create", 0, "abc"), op("reserve", 0, 6), op("appendString", 0, 0), S(0), op("allocations"),
        op("errors"),
    ]),
    case("h-append-own-suffix", True, [
        op("create", 0, "abcd"), op("appendSuffix", 0, 1), S(0), C(0), op("appendSuffix", 0, 0), S(0), C(0),
        op("appendSuffix", 0, 14), S(0), op("reserve", 0, 40), op("appendSuffix", 0, 10), S(0),
        op("allocations"), op("errors"),
    ], "append(c_str() + k) on the same String must work when it reallocates."),

    # ---- append variants and +=
    case("h-append-variants", True, [
        op("create", 0, "ab"), op("create", 1, "cd"), op("plusEquals", 1, 0), S(0), op("appendString", 1, 0),
        S(0), op("append", 0, ""), S(0), op("createEmpty", 2), op("appendString", 2, 0), S(0),
        op("plusEquals", 0, 2), S(2), C(2), op("allocations"),
    ]),

    # ---- comparisons
    case("h-compare", True, [
        op("create", 0, "apple"), op("create", 1, "apples"), op("compare", 0, 1), op("compare", 1, 0),
        op("create", 2, "apple"), op("compare", 0, 2), op("create", 3, "b"), op("compare", 3, 1),
        op("compare", 1, 3), op("createEmpty", 2), op("compare", 2, 0), op("compare", 0, 2),
        op("createEmpty", 1), op("compare", 1, 2), op("create", 3, "applf"), op("compare", 0, 3),
        op("compare", 0, 0),
    ], "Lexicographic order; a proper prefix is less; the empty string is less than any other."),

    # ---- substr
    case("h-substr", True, [
        op("create", 0, "abcdefgh"), op("substr", 0, 0, -1), op("substr", 0, 2, 3), op("substr", 0, 6, 10),
        op("substr", 0, 7, -1), op("substr", 0, 8, -1), op("substr", 0, 8, 0), op("substr", 0, 9, 0),
        op("substr", 0, 3, -2), op("substr", 0, 3, 0), op("substr", 0, 100, 1), op("createEmpty", 1),
        op("substr", 1, 0, -1), op("substr", 1, 1, -1), S(0),
    ], "substr(pos, count) takes min(count, size() - pos) characters; npos and other huge counts must "
       "not overflow pos + count."),
    case("h-substr-allocates-once", True, [
        op("create", 0, "abcdefghijklmnopqrstuvwxyz"), op("allocations"), op("substr", 0, 1, 20),
        op("allocations"), op("substr", 0, 5, 0), op("allocations"), op("substr", 0, 26, 5),
        op("allocations"), op("heapBlocks"),
    ], "A non-empty substr allocates exactly once (an empty one not at all) and frees it when destroyed."),

    # ---- find
    case("h-find", True, [
        op("create", 0, "abababc"), op("create", 1, "abc"), op("find", 0, 1, 0), op("find", 0, 1, 5),
        op("create", 2, "aba"), op("find", 0, 2, 0), op("find", 0, 2, 1), op("find", 0, 2, 2), op("find", 0, 2, 3),
        op("createEmpty", 3), op("find", 0, 3, 0), op("find", 0, 3, 7), op("find", 0, 3, 8), op("find", 3, 3, 0),
        op("find", 3, 1, 0), op("create", 3, "abababcd"), op("find", 0, 3, 0), op("find", 0, 0, 0),
        op("find", 0, 0, 1), op("find", 1, 0, 0), op("find", 0, 1, 1000),
    ], "find returns the first position >= pos, or npos. An empty needle is found at pos when "
       "pos <= size(). A needle longer than the rest of the string is never found (watch for "
       "size() - needle.size() underflowing)."),
    case("h-find-repetitive", True, [
        op("createFill", 0, 300, "a"), op("pushBack", 0, "b"), op("createFill", 1, 30, "a"), op("pushBack", 1, "b"),
        op("find", 0, 1, 0), op("find", 0, 1, 271), op("find", 0, 1, 272), op("createFill", 2, 301, "a"),
        op("find", 0, 2, 0), op("find", 2, 1, 0),
    ]),

    # ---- operator[]
    case("h-index", True, [
        op("create", 0, "hello"), op("charAt", 0, 0), op("charAt", 0, 4), op("setChar", 0, 1, "a"),
        op("setChar", 0, 4, "!"), S(0), op("copyConstruct", 0, 1), op("setChar", 1, 0, "j"), S(0), S(1),
    ]),

    # ---- large
    case("h-large", True,
         [op("createEmpty", 0)] + [op("append", 0, ALPHA) for _ in range(150)] +
         [op("size", 0), C(0), op("allocations"), op("copyConstruct", 0, 1), C(1), op("appendString", 1, 1),
          op("size", 1), C(1), op("create", 2, ALPHA[:10]), op("find", 1, 2, 5000), op("find", 1, 2, 10795),
          op("substr", 0, 5390, -1), op("allocations"), op("heapBlocks")]),
]
rng = random.Random(4242)
for k, n in enumerate([40, 60, 100, 150, 250, 400]):
    tests.append(case(f"h-rand-{k}", True, random_ops(rng, n)))

(here / "tests.json").write_text(json.dumps(tests, separators=(",", ":")) + "\n")
print(len(tests), "tests")
