class Solution:
    def longestCommonPrefix(self, words: list[str]) -> str:
        first = words[0]
        for j, ch in enumerate(first):
            for w in words[1:]:
                if j == len(w) or w[j] != ch:
                    return first[:j]
        return first


if __name__ == "__main__":
    print(Solution().longestCommonPrefix(["interview", "internet", "interval"]))  # inter
