import heapq


class Solution:
    def swimInWater(self, grid: list[list[int]]) -> int:
        """Dijkstra on the bottleneck cost (max height along the path)."""
        n = len(grid)
        seen = [[False] * n for _ in range(n)]
        heap = [(grid[0][0], 0, 0)]
        seen[0][0] = True
        while heap:
            t, r, c = heapq.heappop(heap)
            if r == n - 1 and c == n - 1:
                return t
            for nr, nc in ((r + 1, c), (r - 1, c), (r, c + 1), (r, c - 1)):
                if 0 <= nr < n and 0 <= nc < n and not seen[nr][nc]:
                    seen[nr][nc] = True  # safe: keys popped are non-decreasing, so the first push is optimal
                    heapq.heappush(heap, (max(t, grid[nr][nc]), nr, nc))
        return -1


if __name__ == "__main__":
    print(Solution().swimInWater([[3, 0, 1], [4, 8, 2], [7, 6, 5]]))  # 5
