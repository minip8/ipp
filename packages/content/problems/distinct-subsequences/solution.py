class Solution:
    def numDistinct(self, s: str, t: str) -> int:
        k = len(t)
        if k > len(s):
            return 0
        MASK = (1 << 64) - 1  # the true answer is < 2^31, so arithmetic mod 2^64 is exact for it
        ways = [1] + [0] * k  # ways[j]: ways to form t[:j] from the processed prefix of s
        for ch in s:
            for j in range(k, 0, -1):  # downward so this character is used at most once
                if t[j - 1] == ch:
                    ways[j] = (ways[j] + ways[j - 1]) & MASK
        return ways[k]


if __name__ == "__main__":
    print(Solution().numDistinct("banana", "ban"))  # 3
