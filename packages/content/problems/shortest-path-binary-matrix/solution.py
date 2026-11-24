from collections import deque


class Solution:
    def shortestPathBinaryMatrix(self, grid: list[list[int]]) -> int:
        n = len(grid)
        if grid[0][0] or grid[n - 1][n - 1]:
            return -1
        dist = [[0] * n for _ in range(n)]
        dist[0][0] = 1
        queue = deque([(0, 0)])
        while queue:
            r, c = queue.popleft()
            if r == n - 1 and c == n - 1:
                return dist[r][c]
            for dr in (-1, 0, 1):
                for dc in (-1, 0, 1):
                    nr, nc = r + dr, c + dc
                    if 0 <= nr < n and 0 <= nc < n and grid[nr][nc] == 0 and dist[nr][nc] == 0:
                        dist[nr][nc] = dist[r][c] + 1
                        queue.append((nr, nc))
        return -1


if __name__ == "__main__":
    print(Solution().shortestPathBinaryMatrix([[0, 0, 0], [1, 1, 0], [1, 1, 0]]))  # 4
