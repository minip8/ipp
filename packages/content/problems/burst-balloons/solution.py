class Solution:
    def maxCoins(self, nums: list[int]) -> int:
        a = [1] + nums + [1]
        n = len(a)
        best = [[0] * n for _ in range(n)]  # best[i][j]: coins from bursting everything strictly between i and j
        for length in range(2, n):
            for i in range(0, n - length):
                j = i + length
                ai_aj = a[i] * a[j]
                row_i, top = best[i], 0
                for k in range(i + 1, j):
                    v = row_i[k] + ai_aj * a[k] + best[k][j]  # k is the last balloon burst in (i, j)
                    if v > top:
                        top = v
                row_i[j] = top
        return best[0][n - 1]


if __name__ == "__main__":
    print(Solution().maxCoins([4, 1, 6, 2]))  # 84
