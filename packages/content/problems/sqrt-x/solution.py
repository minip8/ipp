class Solution:
    def mySqrt(self, x: int) -> int:
        lo, hi = 0, min(x, 1 << 27)  # sqrt(2^53) < 2^27
        while lo < hi:
            mid = (lo + hi + 1) // 2
            if mid * mid <= x:
                lo = mid
            else:
                hi = mid - 1
        return lo


if __name__ == "__main__":
    print(Solution().mySqrt(27))  # 5
