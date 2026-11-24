class Solution:
    def largestRectangleArea(self, heights: list[int]) -> int:
        stack: list[int] = []  # indices with increasing heights
        best = 0
        for i, h in enumerate(heights + [0]):  # trailing 0 flushes the stack
            while stack and heights[stack[-1]] >= h:
                top = stack.pop()
                left = stack[-1] if stack else -1
                best = max(best, heights[top] * (i - left - 1))
            stack.append(i)
        return best


if __name__ == "__main__":
    print(Solution().largestRectangleArea([2, 1, 5, 6, 2, 3]))  # 10
