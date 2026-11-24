from collections import Counter


class Solution:
    def leastInterval(self, tasks: list[str], n: int) -> int:
        counts = Counter(tasks).values()
        top = max(counts)
        ties = sum(1 for c in counts if c == top)
        return max(len(tasks), (top - 1) * (n + 1) + ties)


if __name__ == "__main__":
    print(Solution().leastInterval(list("AAABBB"), 2))  # 8
