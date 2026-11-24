from bisect import bisect_right


class SnapshotArray:
    """Per index, parallel lists of (snap id at write time, value); ids are non-decreasing."""

    def __init__(self, length: int) -> None:
        self.ids = [[0] for _ in range(length)]
        self.vals = [[0] for _ in range(length)]
        self.snap_count = 0

    def set(self, index: int, val: int) -> None:
        ids, vals = self.ids[index], self.vals[index]
        if ids[-1] == self.snap_count:
            vals[-1] = val
        else:
            ids.append(self.snap_count)
            vals.append(val)

    def snap(self) -> int:
        self.snap_count += 1
        return self.snap_count - 1

    def get(self, index: int, snapId: int) -> int:
        i = bisect_right(self.ids[index], snapId)  # entry 0 has id 0 <= snapId, so i >= 1
        return self.vals[index][i - 1]


if __name__ == "__main__":
    a = SnapshotArray(3)
    a.set(0, 5)
    print(a.snap())  # 0
    a.set(0, 6)
    a.set(2, 1)
    print(a.snap(), a.snap())  # 1 2
    print(a.get(0, 0), a.get(0, 1), a.get(2, 0), a.get(2, 2), a.get(1, 2))  # 5 6 0 1 0
