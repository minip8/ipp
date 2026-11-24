class Solution:
    def solveNQueens(self, n: int) -> list[list[str]]:
        res: list[list[str]] = []
        queens: list[int] = []               # queens[r] = column of the queen in row r
        cols, diag, anti = set(), set(), set()

        def go(r: int) -> None:
            if r == n:
                res.append(["." * c + "Q" + "." * (n - c - 1) for c in queens])
                return
            for c in range(n):
                if c in cols or r - c in diag or r + c in anti:
                    continue
                cols.add(c); diag.add(r - c); anti.add(r + c); queens.append(c)
                go(r + 1)
                cols.remove(c); diag.remove(r - c); anti.remove(r + c); queens.pop()

        go(0)
        return res


if __name__ == "__main__":
    for board in Solution().solveNQueens(4):
        print("\n".join(board), end="\n\n")
