class Solution:
    def floodFill(self, image: list[list[int]], sr: int, sc: int, color: int) -> list[list[int]]:
        out = [row[:] for row in image]
        old = out[sr][sc]
        if old == color:
            return out
        rows, cols = len(out), len(out[0])
        out[sr][sc] = color
        stack = [(sr, sc)]
        while stack:
            r, c = stack.pop()
            for nr, nc in ((r + 1, c), (r - 1, c), (r, c + 1), (r, c - 1)):
                if 0 <= nr < rows and 0 <= nc < cols and out[nr][nc] == old:
                    out[nr][nc] = color
                    stack.append((nr, nc))
        return out


if __name__ == "__main__":
    print(Solution().floodFill([[1, 1, 0], [1, 0, 2], [1, 1, 1]], 0, 0, 5))
