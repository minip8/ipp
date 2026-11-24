from collections import defaultdict


class Solution:
    def groupAnagrams(self, words: list[str]) -> list[list[str]]:
        groups: dict[tuple[int, ...], list[str]] = defaultdict(list)
        for w in words:
            counts = [0] * 26
            for ch in w:
                counts[ord(ch) - 97] += 1
            groups[tuple(counts)].append(w)
        return list(groups.values())


if __name__ == "__main__":
    print(Solution().groupAnagrams(["listen", "stone", "silent", "notes", "pots", "enlist"]))
