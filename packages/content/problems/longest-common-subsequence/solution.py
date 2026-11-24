class Solution:
    def longestCommonSubsequence(self, text1: str, text2: str) -> int:
        if len(text2) > len(text1):
            text1, text2 = text2, text1
        prev = [0] * (len(text2) + 1)  # row for prefix i-1 of text1
        for a in text1:
            cur = [0] * (len(text2) + 1)
            for j, b in enumerate(text2, 1):
                cur[j] = prev[j - 1] + 1 if a == b else max(prev[j], cur[j - 1])
            prev = cur
        return prev[-1]


if __name__ == "__main__":
    print(Solution().longestCommonSubsequence("kitten", "sitting"))  # 4
