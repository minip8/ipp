class Solution:
    def partition(self, s: str) -> list[list[str]]:
        n = len(s)
        # pal[i][j]: s[i..j] (inclusive) is a palindrome
        pal = [[False] * n for _ in range(n)]
        for i in range(n - 1, -1, -1):
            for j in range(i, n):
                pal[i][j] = s[i] == s[j] and (j - i < 2 or pal[i + 1][j - 1])

        res: list[list[str]] = []
        path: list[str] = []

        def go(start: int) -> None:
            if start == n:
                res.append(path[:])
                return
            for end in range(start, n):
                if pal[start][end]:
                    path.append(s[start:end + 1])
                    go(end + 1)
                    path.pop()

        go(0)
        return res


if __name__ == "__main__":
    print(Solution().partition("abab"))
