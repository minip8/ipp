class Solution:
    def findAnagrams(self, s: str, p: str) -> list[int]:
        n, m = len(s), len(p)
        if m > n:
            return []
        need = [0] * 26
        for ch in p:
            need[ord(ch) - 97] += 1
        window = [0] * 26
        out = []
        for i, ch in enumerate(s):
            window[ord(ch) - 97] += 1
            if i >= m:
                window[ord(s[i - m]) - 97] -= 1
            if i >= m - 1 and window == need:
                out.append(i - m + 1)
        return out


if __name__ == "__main__":
    print(Solution().findAnagrams("cbaebabacd", "abc"))  # [0, 6]
