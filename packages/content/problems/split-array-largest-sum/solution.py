class Solution:
    def splitArray(self, nums: list[int], k: int) -> int:
        def parts_needed(cap: int) -> int:
            parts, cur = 1, 0
            for x in nums:
                if cur + x > cap:
                    parts += 1
                    cur = 0
                cur += x
            return parts

        lo, hi = max(nums), sum(nums)
        while lo < hi:
            mid = (lo + hi) // 2
            if parts_needed(mid) <= k:
                hi = mid
            else:
                lo = mid + 1
        return lo


if __name__ == "__main__":
    print(Solution().splitArray([7, 2, 5, 10, 8], 2))  # 18
