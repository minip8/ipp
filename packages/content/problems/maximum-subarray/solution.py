class Solution:
    def maxSubArray(self, nums: list[int]) -> int:
        best = cur = nums[0]
        for x in nums[1:]:
            cur = max(x, cur + x)
            best = max(best, cur)
        return best


if __name__ == "__main__":
    print(Solution().maxSubArray([3, -4, 5, -1, 2, -6, 1]))  # 6
