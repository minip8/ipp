class Solution:
    def sortedSquares(self, nums: list[int]) -> list[int]:
        n = len(nums)
        out = [0] * n
        lo, hi = 0, n - 1
        for k in range(n - 1, -1, -1):
            if abs(nums[lo]) > abs(nums[hi]):
                out[k] = nums[lo] * nums[lo]
                lo += 1
            else:
                out[k] = nums[hi] * nums[hi]
                hi -= 1
        return out


if __name__ == "__main__":
    print(Solution().sortedSquares([-5, -2, 0, 3, 4]))  # [0, 4, 9, 16, 25]
