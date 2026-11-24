class Solution:
    def trap(self, height: list[int]) -> int:
        lo, hi = 0, len(height) - 1
        left_max = right_max = water = 0
        while lo < hi:
            if height[lo] < height[hi]:
                left_max = max(left_max, height[lo])
                water += left_max - height[lo]
                lo += 1
            else:
                right_max = max(right_max, height[hi])
                water += right_max - height[hi]
                hi -= 1
        return water


if __name__ == "__main__":
    print(Solution().trap([0, 1, 0, 2, 1, 0, 1, 3, 2, 1, 2, 1]))  # 6
