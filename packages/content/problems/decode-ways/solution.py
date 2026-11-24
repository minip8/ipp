class Solution:
    def numDecodings(self, s: str) -> int:
        prev2, prev1 = 0, 1  # ways for the prefixes of length i-2 and i-1 (with i = 1: none and empty)
        for i in range(1, len(s) + 1):
            cur = prev1 if s[i - 1] != "0" else 0
            if i >= 2 and 10 <= int(s[i - 2:i]) <= 26:
                cur += prev2
            prev2, prev1 = prev1, cur
        return prev1


if __name__ == "__main__":
    s = Solution()
    print(s.numDecodings("226"), s.numDecodings("105"), s.numDecodings("30"))  # 3 1 0
