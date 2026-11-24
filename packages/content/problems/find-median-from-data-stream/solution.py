import heapq


class MedianFinder:
    """low: max-heap (negated) of the smaller half; high: min-heap of the larger half.
    Invariant: len(low) == len(high) or len(low) == len(high) + 1."""

    def __init__(self) -> None:
        self.low: list[int] = []
        self.high: list[int] = []

    def addNum(self, num: int) -> None:
        heapq.heappush(self.low, -num)
        heapq.heappush(self.high, -heapq.heappop(self.low))
        if len(self.high) > len(self.low):
            heapq.heappush(self.low, -heapq.heappop(self.high))

    def findMedian(self) -> float:
        if len(self.low) > len(self.high):
            return float(-self.low[0])
        return (-self.low[0] + self.high[0]) / 2.0


if __name__ == "__main__":
    m = MedianFinder()
    for x in [5, 1, 9, 2]:
        m.addNum(x)
        print(m.findMedian())  # 5.0 3.0 5.0 3.5
