class Solution:
    def maximalSquare(self, matrix: list[str]) -> int:
        cols = len(matrix[0])
        prev = [0] * (cols + 1)  # side lengths for the previous row, shifted by one column
        best = 0
        for row in matrix:
            cur = [0] * (cols + 1)
            for c in range(1, cols + 1):
                if row[c - 1] == "1":
                    cur[c] = 1 + min(prev[c], cur[c - 1], prev[c - 1])
                    if cur[c] > best:
                        best = cur[c]
            prev = cur
        return best * best


if __name__ == "__main__":
    print(Solution().maximalSquare(["10100", "10111", "11111", "10010"]))  # 4
