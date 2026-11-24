class Solution:
    def threeSum(self, nums: list[int]) -> list[list[int]]:
        nums = sorted(nums)
        n, out = len(nums), []
        for i in range(n - 2):
            a = nums[i]
            if a > 0:
                break
            if i and a == nums[i - 1]:
                continue
            lo, hi = i + 1, n - 1
            while lo < hi:
                s = a + nums[lo] + nums[hi]
                if s < 0:
                    lo += 1
                elif s > 0:
                    hi -= 1
                else:
                    out.append([a, nums[lo], nums[hi]])
                    lo += 1
                    hi -= 1
                    while lo < hi and nums[lo] == nums[lo - 1]:
                        lo += 1
                    while lo < hi and nums[hi] == nums[hi + 1]:
                        hi -= 1
        return out


if __name__ == "__main__":
    print(Solution().threeSum([-2, 0, 1, 1, 2, -1]))
