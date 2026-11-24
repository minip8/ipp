import heapq
from collections import Counter


class _Entry:
    """Heap entry whose 'smallest' is the weakest word: lower count, then alphabetically larger."""
    __slots__ = ("count", "word")

    def __init__(self, count: int, word: str) -> None:
        self.count, self.word = count, word

    def __lt__(self, other: "_Entry") -> bool:
        if self.count != other.count:
            return self.count < other.count
        return self.word > other.word


class Solution:
    def topKFrequent(self, words: list[str], k: int) -> list[str]:
        counts = Counter(words)
        heap: list[_Entry] = []
        for word, c in counts.items():
            heapq.heappush(heap, _Entry(c, word))
            if len(heap) > k:
                heapq.heappop(heap)
        out = []
        while heap:
            out.append(heapq.heappop(heap).word)
        return out[::-1]


if __name__ == "__main__":
    print(Solution().topKFrequent(["go", "run", "go", "jump", "run", "go", "fly"], 2))  # ['go', 'run']
