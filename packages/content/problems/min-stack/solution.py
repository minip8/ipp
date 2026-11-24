class MinStack:
    """Each entry stores (value, minimum of the stack up to and including this entry)."""

    def __init__(self) -> None:
        self.items: list[tuple[int, int]] = []

    def push(self, val: int) -> None:
        cur_min = min(val, self.items[-1][1]) if self.items else val
        self.items.append((val, cur_min))

    def pop(self) -> None:
        self.items.pop()

    def top(self) -> int:
        return self.items[-1][0]

    def getMin(self) -> int:
        return self.items[-1][1]


if __name__ == "__main__":
    s = MinStack()
    for v in (4, 2, 7):
        s.push(v)
    print(s.getMin())  # 2
    s.pop()
    s.pop()
    print(s.getMin(), s.top())  # 4 4
