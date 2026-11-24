from collections import deque


class Solution:
    def maxSlidingWindow(self, nums: list[int], k: int) -> list[int]:
        window: deque[int] = deque()  # indices; their values strictly decrease front to back
        out: list[int] = []
        for i, x in enumerate(nums):
            while window and nums[window[-1]] <= x:
                window.pop()
            window.append(i)
            if window[0] <= i - k:
                window.popleft()
            if i >= k - 1:
                out.append(nums[window[0]])
        return out


if __name__ == "__main__":
    print(Solution().maxSlidingWindow([4, 2, 12, 3, 8, 1, 7], 3))  # [12, 12, 12, 8, 8]
