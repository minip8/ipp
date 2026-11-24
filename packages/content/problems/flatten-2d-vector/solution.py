class Vector2D:
    """Two indices into the original list; _settle() moves them onto a real element or past the end."""

    def __init__(self, vec: list[list[int]]) -> None:
        self.vec = vec
        self.row = 0
        self.col = 0

    def _settle(self) -> None:
        while self.row < len(self.vec) and self.col == len(self.vec[self.row]):
            self.row += 1
            self.col = 0

    def next(self) -> int:
        self._settle()
        val = self.vec[self.row][self.col]
        self.col += 1
        return val

    def hasNext(self) -> bool:
        self._settle()
        return self.row < len(self.vec)


if __name__ == "__main__":
    it = Vector2D([[1, 2], [], [3], [], []])
    out = []
    while it.hasNext():
        out.append(it.next())
    print(out)  # [1, 2, 3]
