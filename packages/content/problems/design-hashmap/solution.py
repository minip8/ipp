class MyHashMap:
    """Open addressing with linear probing and tombstones; doubles when load exceeds 1/2."""

    _EMPTY, _TOMB = -1, -2

    def __init__(self) -> None:
        self._alloc(16)

    def _alloc(self, cap: int) -> None:
        self.keys = [self._EMPTY] * cap
        self.vals = [0] * cap
        self.used = 0  # live keys + tombstones
        self.size = 0

    def _slot(self, key: int) -> int:
        # Fibonacci hashing: multiply, keep 64 bits, take high-ish bits (low bits of key*odd are weak).
        return (((key * 0x9E3779B97F4A7C15) & 0xFFFFFFFFFFFFFFFF) >> 20) & (len(self.keys) - 1)

    def _find(self, key: int) -> int:
        """Index holding key, or -1."""
        i, mask = self._slot(key), len(self.keys) - 1
        while self.keys[i] != self._EMPTY:
            if self.keys[i] == key:
                return i
            i = (i + 1) & mask
        return -1

    def _grow(self) -> None:
        old = [(k, v) for k, v in zip(self.keys, self.vals) if k >= 0]
        self._alloc(len(self.keys) * 2 if self.size * 4 >= len(self.keys) else len(self.keys))
        for k, v in old:
            self.put(k, v)

    def put(self, key: int, value: int) -> None:
        i = self._find(key)
        if i >= 0:
            self.vals[i] = value
            return
        if (self.used + 1) * 2 > len(self.keys):
            self._grow()
        i, mask = self._slot(key), len(self.keys) - 1
        while self.keys[i] >= 0:  # stop at the first empty or tombstone slot
            i = (i + 1) & mask
        if self.keys[i] == self._EMPTY:
            self.used += 1
        self.keys[i], self.vals[i] = key, value
        self.size += 1

    def get(self, key: int) -> int:
        i = self._find(key)
        return self.vals[i] if i >= 0 else -1

    def remove(self, key: int) -> None:
        i = self._find(key)
        if i >= 0:
            self.keys[i] = self._TOMB
            self.size -= 1


if __name__ == "__main__":
    m = MyHashMap()
    m.put(3, 30)
    m.put(1003, 7)
    print(m.get(3), m.get(1003), m.get(5))  # 30 7 -1
    m.remove(1003)
    print(m.get(1003))  # -1
