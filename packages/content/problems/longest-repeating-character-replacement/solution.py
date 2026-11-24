class Solution:
    def characterReplacement(self, s: str, k: int) -> int:
        counts = [0] * 26
        left = maxf = best = 0
        for right, ch in enumerate(s):
            c = ord(ch) - 65
            counts[c] += 1
            maxf = max(maxf, counts[c])
            while right - left + 1 - maxf > k:
                counts[ord(s[left]) - 65] -= 1
                left += 1
            best = max(best, right - left + 1)
        return best


if __name__ == "__main__":
    print(Solution().characterReplacement("AABABBA", 1))  # 4
