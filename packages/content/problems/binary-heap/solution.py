EMPTY = -(2**31)


class BinaryHeap:
    def __init__(self) -> None:
        self.a: list[int] = []

    def _sift_up(self, i: int) -> None:
        a = self.a
        while i > 0:
            p = (i - 1) // 2
            if a[i] <= a[p]:
                break
            a[i], a[p] = a[p], a[i]
            i = p

    def _sift_down(self, i: int) -> None:
        a, n = self.a, len(self.a)
        while True:
            c = 2 * i + 1
            if c >= n:
                return
            if c + 1 < n and a[c + 1] > a[c]:
                c += 1
            if a[c] <= a[i]:
                return
            a[i], a[c] = a[c], a[i]
            i = c

    def push(self, value: int) -> None:
        self.a.append(value)
        self._sift_up(len(self.a) - 1)

    def pop(self) -> int:
        a = self.a
        if not a:
            return EMPTY
        top = a[0]
        last = a.pop()
        if a:
            a[0] = last
            self._sift_down(0)
        return top

    def top(self) -> int:
        return self.a[0] if self.a else EMPTY

    def size(self) -> int:
        return len(self.a)

    def build(self, values: list[int]) -> None:
        self.a = list(values)
        for i in range(len(self.a) // 2 - 1, -1, -1):
            self._sift_down(i)

    def replaceTop(self, value: int) -> int:
        if not self.a:
            self.a.append(value)
            return EMPTY
        top = self.a[0]
        self.a[0] = value
        self._sift_down(0)
        return top

    def toArray(self) -> list[int]:
        return list(self.a)


if __name__ == "__main__":
    h = BinaryHeap()
    for v in (3, 8, 5, 9):
        h.push(v)
    print(h.pop(), h.toArray())  # 9 [8, 3, 5]
    print(h.replaceTop(1), h.toArray())  # 8 [5, 3, 1]
    h.build([1, 2, 3, 4, 5])
    print(h.toArray())  # [5, 4, 3, 1, 2]
