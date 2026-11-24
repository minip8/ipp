class Solution:
    def minEatingSpeed(self, piles: list[int], h: int) -> int:
        lo, hi = 1, max(piles)
        while lo < hi:
            k = (lo + hi) // 2
            hours = sum((p + k - 1) // k for p in piles)
            if hours <= h:
                hi = k
            else:
                lo = k + 1
        return lo


if __name__ == "__main__":
    print(Solution().minEatingSpeed([3, 6, 7, 11], 8))  # 4
