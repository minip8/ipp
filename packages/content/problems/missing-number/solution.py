class Solution:
    def missingNumber(self, nums: list[int]) -> int:
        acc = len(nums)
        for i, x in enumerate(nums):
            acc ^= i ^ x
        return acc


if __name__ == "__main__":
    print(Solution().missingNumber([3, 0, 1]))  # 2
