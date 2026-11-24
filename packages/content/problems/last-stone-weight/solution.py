import heapq


class Solution:
    def lastStoneWeight(self, stones: list[int]) -> int:
        heap = [-s for s in stones]  # heapq is a min-heap; negate for max-heap behaviour
        heapq.heapify(heap)
        while len(heap) > 1:
            y = -heapq.heappop(heap)
            x = -heapq.heappop(heap)
            if y != x:
                heapq.heappush(heap, -(y - x))
        return -heap[0] if heap else 0


if __name__ == "__main__":
    print(Solution().lastStoneWeight([3, 8, 4, 1, 5]))  # 1
