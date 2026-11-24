import heapq


class KthLargest:
    """Min-heap of the k largest values seen so far; its top is the answer."""

    def __init__(self, k: int, nums: list[int]) -> None:
        self.k = k
        self.heap = list(nums)
        heapq.heapify(self.heap)
        while len(self.heap) > k:
            heapq.heappop(self.heap)

    def add(self, val: int) -> int:
        if len(self.heap) < self.k:
            heapq.heappush(self.heap, val)
        elif val > self.heap[0]:
            heapq.heapreplace(self.heap, val)
        return self.heap[0]


if __name__ == "__main__":
    t = KthLargest(3, [6, 1, 9, 4])
    print([t.add(v) for v in (2, 7, 10, 7, 0)])  # [4, 6, 7, 7, 7]
