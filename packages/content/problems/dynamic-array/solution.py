class DynamicArray:
    """Growable array on raw storage: `buf` is a fixed-size list that is only indexed or replaced
    by a new block, never appended to or shortened."""

    def __init__(self) -> None:
        self.buf = []
        self.n = 0

    def _realloc(self, cap: int) -> None:
        nb = [0] * cap
        nb[: self.n] = self.buf[: self.n]  # copy the live elements into the new block
        self.buf = nb

    def _grow_for_one(self) -> None:
        if self.n == len(self.buf):
            self._realloc(1 if not self.buf else 2 * len(self.buf))

    def pushBack(self, value: int) -> None:
        self._grow_for_one()
        self.buf[self.n] = value
        self.n += 1

    def popBack(self) -> int:
        if self.n == 0:
            return -1
        self.n -= 1
        return self.buf[self.n]

    def get(self, index: int) -> int:
        return self.buf[index] if 0 <= index < self.n else -1

    def set(self, index: int, value: int) -> bool:
        if not 0 <= index < self.n:
            return False
        self.buf[index] = value
        return True

    def insert(self, index: int, value: int) -> bool:
        if not 0 <= index <= self.n:
            return False
        self._grow_for_one()
        b = self.buf
        for i in range(self.n, index, -1):
            b[i] = b[i - 1]
        b[index] = value
        self.n += 1
        return True

    def erase(self, index: int) -> int:
        if not 0 <= index < self.n:
            return -1
        b = self.buf
        removed = b[index]
        for i in range(index, self.n - 1):
            b[i] = b[i + 1]
        self.n -= 1
        return removed

    def size(self) -> int:
        return self.n

    def capacity(self) -> int:
        return len(self.buf)

    def reserve(self, n: int) -> None:
        if n > len(self.buf):
            self._realloc(n)

    def resize(self, n: int, value: int) -> None:
        if n > len(self.buf):
            self._realloc(max(n, 2 * len(self.buf)))
        if n > self.n:
            self.buf[self.n : n] = [value] * (n - self.n)  # same length: a block fill, not a resize
        self.n = n

    def shrinkToFit(self) -> None:
        if len(self.buf) != self.n:
            self._realloc(self.n)

    def toArray(self) -> list[int]:
        return self.buf[: self.n]


if __name__ == "__main__":
    a = DynamicArray()
    for v in (5, 6, 7):
        a.pushBack(v)
    print(a.capacity())  # 4
    a.insert(0, 4)
    print(a.erase(1), a.popBack(), a.toArray())  # 5 7 [4, 6]
    a.shrinkToFit()
    print(a.capacity())  # 2
