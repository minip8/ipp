class Solution:
    def rob(self, nums: list[int]) -> int:
        prev2, prev1 = 0, 0  # best over houses [0, i-2] and [0, i-1]
        for x in nums:
            prev2, prev1 = prev1, max(prev1, prev2 + x)
        return prev1


if __name__ == "__main__":
    print(Solution().rob([3, 10, 4, 2, 8]))  # 18
