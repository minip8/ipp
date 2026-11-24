class Solution:
    def coinChange(self, coins: list[int], amount: int) -> int:
        INF = amount + 1
        dp = [0] + [INF] * amount
        for a in range(1, amount + 1):
            best = INF
            for c in coins:
                if c <= a and dp[a - c] + 1 < best:
                    best = dp[a - c] + 1
            dp[a] = best
        return dp[amount] if dp[amount] <= amount else -1


if __name__ == "__main__":
    print(Solution().coinChange([1, 5, 6, 9], 11))  # 2
    print(Solution().coinChange([4, 6], 7))  # -1
