class Solution:
    def longestIncreasingPath(self, matrix: list[list[int]]) -> int:
        # Process cells from the largest value down: every larger neighbour is final before it is read.
        # (Iterative on purpose: an increasing path can be thousands of cells long.)
        m, n = len(matrix), len(matrix[0])
        best = [[1] * n for _ in range(m)]
        cells = sorted(((matrix[r][c], r, c) for r in range(m) for c in range(n)), reverse=True)
        answer = 1
        for v, r, c in cells:
            b = 1
            for nr, nc in ((r - 1, c), (r + 1, c), (r, c - 1), (r, c + 1)):
                if 0 <= nr < m and 0 <= nc < n and matrix[nr][nc] > v and best[nr][nc] + 1 > b:
                    b = best[nr][nc] + 1
            best[r][c] = b
            if b > answer:
                answer = b
        return answer


if __name__ == "__main__":
    print(Solution().longestIncreasingPath([[7, 8, 9], [6, 1, 2], [5, 4, 3]]))  # 9
