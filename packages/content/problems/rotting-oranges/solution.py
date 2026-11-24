class Solution:
    def orangesRotting(self, grid: list[list[int]]) -> int:
        rows, cols = len(grid), len(grid[0])
        g = [row[:] for row in grid]
        frontier = [(r, c) for r in range(rows) for c in range(cols) if g[r][c] == 2]
        fresh = sum(row.count(1) for row in g)
        minutes = 0
        while frontier and fresh:
            nxt = []
            for r, c in frontier:
                for nr, nc in ((r + 1, c), (r - 1, c), (r, c + 1), (r, c - 1)):
                    if 0 <= nr < rows and 0 <= nc < cols and g[nr][nc] == 1:
                        g[nr][nc] = 2
                        fresh -= 1
                        nxt.append((nr, nc))
            frontier = nxt
            minutes += 1
        return -1 if fresh else minutes


if __name__ == "__main__":
    print(Solution().orangesRotting([[2, 1, 1], [1, 1, 0], [0, 1, 1]]))  # 4
