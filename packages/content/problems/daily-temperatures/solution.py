class Solution:
    def dailyTemperatures(self, temperatures: list[int]) -> list[int]:
        ans = [0] * len(temperatures)
        waiting: list[int] = []  # indices, temperatures non-increasing from bottom to top
        for i, t in enumerate(temperatures):
            while waiting and temperatures[waiting[-1]] < t:
                j = waiting.pop()
                ans[j] = i - j
            waiting.append(i)
        return ans


if __name__ == "__main__":
    print(Solution().dailyTemperatures([70, 68, 72, 71, 69, 75]))  # [2, 1, 3, 2, 1, 0]
