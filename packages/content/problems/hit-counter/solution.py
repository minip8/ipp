from collections import deque

WINDOW = 300


class HitCounter:
    """Queue of [timestamp, count] buckets (one per distinct second), plus a running total."""

    def __init__(self) -> None:
        self.buckets: deque[list[int]] = deque()
        self.total = 0

    def _expire(self, timestamp: int) -> None:
        while self.buckets and self.buckets[0][0] <= timestamp - WINDOW:
            self.total -= self.buckets.popleft()[1]

    def hit(self, timestamp: int) -> None:
        self._expire(timestamp)
        if self.buckets and self.buckets[-1][0] == timestamp:
            self.buckets[-1][1] += 1
        else:
            self.buckets.append([timestamp, 1])
        self.total += 1

    def getHits(self, timestamp: int) -> int:
        self._expire(timestamp)
        return self.total


if __name__ == "__main__":
    c = HitCounter()
    for t in (1, 2, 2):
        c.hit(t)
    print(c.getHits(4))  # 3
    c.hit(300)
    print([c.getHits(t) for t in (300, 301, 302, 1000)])  # [4, 3, 1, 0]
