import bisect


class Allocator:
    """Free list of disjoint, non-adjacent intervals kept sorted by start (parallel lists),
    plus, for each mID, the blocks it owns. allocate scans the free list (first fit);
    freeMemory re-inserts each block and merges it with its neighbours."""

    def __init__(self, n: int) -> None:
        self.starts = [0]
        self.ends = [n]           # half-open [start, end)
        self.owned: dict[int, list[tuple[int, int]]] = {}

    def allocate(self, size: int, mID: int) -> int:
        for i, (s, e) in enumerate(zip(self.starts, self.ends)):
            if e - s >= size:
                if e - s == size:
                    del self.starts[i], self.ends[i]
                else:
                    self.starts[i] = s + size
                self.owned.setdefault(mID, []).append((s, s + size))
                return s
        return -1

    def _release(self, s: int, e: int) -> None:
        i = bisect.bisect_left(self.starts, s)
        if i > 0 and self.ends[i - 1] == s:          # merge with left neighbour
            i -= 1
            s = self.starts[i]
            del self.starts[i], self.ends[i]
        if i < len(self.starts) and self.starts[i] == e:  # merge with right neighbour
            e = self.ends[i]
            del self.starts[i], self.ends[i]
        self.starts.insert(i, s)
        self.ends.insert(i, e)

    def freeMemory(self, mID: int) -> int:
        blocks = self.owned.pop(mID, [])
        for s, e in blocks:
            self._release(s, e)
        return sum(e - s for s, e in blocks)


if __name__ == "__main__":
    a = Allocator(10)
    print(a.allocate(3, 1), a.allocate(2, 2), a.allocate(4, 1))  # 0 3 5
    print(a.freeMemory(2), a.allocate(3, 3), a.allocate(1, 3))  # 2 -1 3
    print(a.freeMemory(1), a.allocate(6, 4), a.freeMemory(9))  # 7 4 0
