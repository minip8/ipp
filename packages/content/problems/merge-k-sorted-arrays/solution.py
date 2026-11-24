import heapq


class Solution:
    def mergeKArrays(self, arrays: list[list[int]]) -> list[int]:
        """k-way merge with a min-heap of (value, array index, position): O(N log k)."""
        heap = [(a[0], i, 0) for i, a in enumerate(arrays) if a]
        heapq.heapify(heap)
        out = []
        while heap:
            value, i, j = heap[0]
            out.append(value)
            if j + 1 < len(arrays[i]):
                heapq.heapreplace(heap, (arrays[i][j + 1], i, j + 1))
            else:
                heapq.heappop(heap)
        return out


if __name__ == "__main__":
    print(Solution().mergeKArrays([[1, 4, 5], [1, 3, 4], [2, 6]]))
