class Solution:
    def maxArea(self, height: list[int]) -> int:
        lo, hi, best = 0, len(height) - 1, 0
        while lo < hi:
            if height[lo] <= height[hi]:
                best = max(best, height[lo] * (hi - lo))
                lo += 1
            else:
                best = max(best, height[hi] * (hi - lo))
                hi -= 1
        return best


if __name__ == "__main__":
    print(Solution().maxArea([2, 7, 3, 6, 4, 1]))  # 12
