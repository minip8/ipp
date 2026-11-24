class Solution:
    def pacificAtlantic(self, heights: list[list[int]]) -> list[list[int]]:
        rows, cols = len(heights), len(heights[0])

        def climb(starts: list[tuple[int, int]]) -> list[list[bool]]:
            seen = [[False] * cols for _ in range(rows)]
            for r, c in starts:
                seen[r][c] = True
            stack = list(starts)
            while stack:
                r, c = stack.pop()
                h = heights[r][c]
                for nr, nc in ((r + 1, c), (r - 1, c), (r, c + 1), (r, c - 1)):
                    if 0 <= nr < rows and 0 <= nc < cols and not seen[nr][nc] and heights[nr][nc] >= h:
                        seen[nr][nc] = True
                        stack.append((nr, nc))
            return seen

        pacific = climb([(0, c) for c in range(cols)] + [(r, 0) for r in range(1, rows)])
        atlantic = climb([(rows - 1, c) for c in range(cols)] + [(r, cols - 1) for r in range(rows - 1)])
        return [[r, c] for r in range(rows) for c in range(cols) if pacific[r][c] and atlantic[r][c]]


if __name__ == "__main__":
    print(Solution().pacificAtlantic([[1, 2, 3], [8, 9, 4], [7, 6, 5]]))
