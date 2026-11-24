class RingDeque:
    """Circular buffer: `buf` is a fixed-size list (only indexed, or replaced by a larger block);
    the elements are buf[head], buf[head + 1], ... wrapping around, `n` of them."""

    def __init__(self) -> None:
        self.buf = [0] * 8
        self.head = 0
        self.n = 0

    def _grow(self, need: int) -> None:
        cap = len(self.buf)
        if need <= cap:
            return
        new_cap = cap
        while new_cap < need:
            new_cap *= 2
        nb = [0] * new_cap
        # Unwrap: copy [head, end) then [0, rest) so the front lands at index 0.
        first = min(self.n, cap - self.head)
        nb[:first] = self.buf[self.head : self.head + first]
        nb[first : self.n] = self.buf[: self.n - first]
        self.buf, self.head = nb, 0

    def pushFront(self, value: int) -> None:
        self._grow(self.n + 1)
        self.head = (self.head - 1) % len(self.buf)
        self.buf[self.head] = value
        self.n += 1

    def pushBack(self, value: int) -> None:
        self._grow(self.n + 1)
        self.buf[(self.head + self.n) % len(self.buf)] = value
        self.n += 1

    def popFront(self) -> int:
        if self.n == 0:
            return -1
        v = self.buf[self.head]
        self.head = (self.head + 1) % len(self.buf)
        self.n -= 1
        return v

    def popBack(self) -> int:
        if self.n == 0:
            return -1
        self.n -= 1
        return self.buf[(self.head + self.n) % len(self.buf)]

    def front(self) -> int:
        return self.buf[self.head] if self.n else -1

    def back(self) -> int:
        return self.buf[(self.head + self.n - 1) % len(self.buf)] if self.n else -1

    def get(self, index: int) -> int:
        if not 0 <= index < self.n:
            return -1
        return self.buf[(self.head + index) % len(self.buf)]

    def size(self) -> int:
        return self.n

    def resize(self, n: int, value: int) -> None:
        if n > self.n:
            self._grow(n)
            cap = len(self.buf)
            start = (self.head + self.n) % cap  # first free slot after the back
            count = n - self.n
            first = min(count, cap - start)
            self.buf[start : start + first] = [value] * first
            self.buf[: count - first] = [value] * (count - first)
        self.n = n

    def toArray(self) -> list[int]:
        cap = len(self.buf)
        first = min(self.n, cap - self.head)
        return self.buf[self.head : self.head + first] + self.buf[: self.n - first]


if __name__ == "__main__":
    d = RingDeque()
    d.pushBack(2)
    d.pushBack(3)
    d.pushFront(1)
    d.pushFront(0)
    print(d.toArray(), d.get(1))  # [0, 1, 2, 3] 1
    print(d.popBack(), d.popFront())  # 3 0
    d.pushBack(9)
    d.resize(5, 4)
    print(d.toArray())  # [1, 2, 9, 4, 4]
