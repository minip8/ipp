from collections import Counter


class Solution:
    def minWindow(self, s: str, t: str) -> str:
        need = Counter(t)
        missing = len(t)
        best_start, best_len = 0, float("inf")
        left = 0
        for right, ch in enumerate(s):
            if need[ch] > 0:
                missing -= 1
            need[ch] -= 1
            if missing == 0:
                while need[s[left]] < 0:  # surplus character: safe to drop
                    need[s[left]] += 1
                    left += 1
                if right - left + 1 < best_len:
                    best_start, best_len = left, right - left + 1
                need[s[left]] += 1  # drop a required character and keep searching
                missing += 1
                left += 1
        return "" if best_len == float("inf") else s[best_start:best_start + best_len]


if __name__ == "__main__":
    print(Solution().minWindow("XADOBECODEBANC", "ABC"))  # BANC
