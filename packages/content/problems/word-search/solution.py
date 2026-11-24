from collections import Counter


class Solution:
    def exist(self, board: list[str], word: str) -> bool:
        rows, cols = len(board), len(board[0])
        if len(word) > rows * cols:
            return False
        have = Counter("".join(board))
        if any(have[ch] < k for ch, k in Counter(word).items()):
            return False
        if have[word[0]] > have[word[-1]]:
            word = word[::-1]  # start from the rarer end: fewer roots to try

        grid = [list(row) for row in board]
        n = len(word)

        def dfs(r: int, c: int, i: int) -> bool:
            if grid[r][c] != word[i]:
                return False
            if i == n - 1:
                return True
            grid[r][c] = "#"
            for nr, nc in ((r + 1, c), (r - 1, c), (r, c + 1), (r, c - 1)):
                if 0 <= nr < rows and 0 <= nc < cols and dfs(nr, nc, i + 1):
                    grid[r][c] = word[i]
                    return True
            grid[r][c] = word[i]
            return False

        return any(dfs(r, c, 0) for r in range(rows) for c in range(cols))


if __name__ == "__main__":
    b = ["CAT", "XOD", "GSE"]
    print(Solution().exist(b, "ATDOS"), Solution().exist(b, "TODO"))
