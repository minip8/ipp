class Solution:
    def change(self, amount: int, coins: list[int]) -> int:
        dp = [1] + [0] * amount  # dp[a] = combinations of a using the coins seen so far
        for c in coins:
            for a in range(c, amount + 1):
                dp[a] += dp[a - c]
        return dp[amount]


if __name__ == "__main__":
    print(Solution().change(5, [1, 2, 5]))  # 4
