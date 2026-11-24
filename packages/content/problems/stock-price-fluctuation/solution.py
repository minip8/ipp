import heapq


class StockPrice:
    """Price per timestamp plus a max-heap and min-heap with lazy deletion of corrected entries."""

    def __init__(self) -> None:
        self.prices: dict[int, int] = {}
        self.latest = 0
        self.max_heap: list[tuple[int, int]] = []  # (-price, timestamp)
        self.min_heap: list[tuple[int, int]] = []  # (price, timestamp)

    def update(self, timestamp: int, price: int) -> None:
        self.prices[timestamp] = price
        self.latest = max(self.latest, timestamp)
        heapq.heappush(self.max_heap, (-price, timestamp))
        heapq.heappush(self.min_heap, (price, timestamp))

    def current(self) -> int:
        return self.prices[self.latest]

    def maximum(self) -> int:
        while self.prices[self.max_heap[0][1]] != -self.max_heap[0][0]:
            heapq.heappop(self.max_heap)  # stale: that timestamp was corrected
        return -self.max_heap[0][0]

    def minimum(self) -> int:
        while self.prices[self.min_heap[0][1]] != self.min_heap[0][0]:
            heapq.heappop(self.min_heap)
        return self.min_heap[0][0]


if __name__ == "__main__":
    s = StockPrice()
    s.update(1, 10)
    s.update(2, 5)
    print(s.current(), s.maximum())  # 5 10
    s.update(1, 3)
    print(s.maximum())  # 5
