class Solution:
    def isMatch(self, s: str, p: str) -> bool:
        n, m = len(s), len(p)
        # nxt[j] = does s[i+1:] match p[j:]; cur[j] = does s[i:] match p[j:]
        nxt = [False] * (m + 1)
        nxt[m] = True  # row i = n: empty suffix of s
        for j in range(m - 1, -1, -1):
            nxt[j] = j + 1 < m and p[j + 1] == "*" and nxt[j + 2]
        for i in range(n - 1, -1, -1):
            cur = [False] * (m + 1)
            for j in range(m - 1, -1, -1):
                first = p[j] == s[i] or p[j] == "."
                if j + 1 < m and p[j + 1] == "*":
                    cur[j] = cur[j + 2] or (first and nxt[j])
                elif p[j] != "*":
                    cur[j] = first and nxt[j + 1]
            nxt = cur
        return nxt[0]


if __name__ == "__main__":
    print(Solution().isMatch("aab", "c*a*b"), Solution().isMatch("ab", ".*c"))  # True False
