class Solution:
    def lengthOfLongestSubstring(self, s: str) -> int:
        last: dict[str, int] = {}
        left = best = 0
        for right, ch in enumerate(s):
            if last.get(ch, -1) >= left:
                left = last[ch] + 1
            last[ch] = right
            best = max(best, right - left + 1)
        return best


if __name__ == "__main__":
    print(Solution().lengthOfLongestSubstring("pwwkew"))  # 3
