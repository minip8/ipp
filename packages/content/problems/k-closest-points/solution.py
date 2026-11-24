import heapq


class Solution:
    def kClosest(self, points: list[list[int]], k: int) -> list[list[int]]:
        """Bounded max-heap of size k (negated squared distances): O(n log k)."""
        heap: list[tuple[int, int]] = []
        for i, (x, y) in enumerate(points):
            d = x * x + y * y
            if len(heap) < k:
                heapq.heappush(heap, (-d, i))
            elif d < -heap[0][0]:
                heapq.heapreplace(heap, (-d, i))
        return [points[i] for _, i in heap]


if __name__ == "__main__":
    print(Solution().kClosest([[1, 3], [-2, 2], [5, -1]], 2))
