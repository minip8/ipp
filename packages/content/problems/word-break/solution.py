class Solution:
    def wordBreak(self, s: str, wordDict: list[str]) -> bool:
        words = set(wordDict)
        lengths = sorted({len(w) for w in words})
        n = len(s)
        ok = [False] * (n + 1)  # ok[i]: s[:i] can be segmented
        ok[0] = True
        for i in range(1, n + 1):
            for L in lengths:
                if L > i:
                    break
                if ok[i - L] and s[i - L:i] in words:
                    ok[i] = True
                    break
        return ok[n]


if __name__ == "__main__":
    print(Solution().wordBreak("icecreamcone", ["ice", "cream", "icecream", "cone"]))  # True
    print(Solution().wordBreak("catsandog", ["cats", "dog", "sand", "and", "cat"]))  # False
