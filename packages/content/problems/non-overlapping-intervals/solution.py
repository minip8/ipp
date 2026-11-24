class Solution:
    def eraseOverlapIntervals(self, intervals: list[list[int]]) -> int:
        kept, last_end = 0, float("-inf")
        for start, end in sorted(intervals, key=lambda iv: iv[1]):
            if start >= last_end:
                kept += 1
                last_end = end
        return len(intervals) - kept


if __name__ == "__main__":
    print(Solution().eraseOverlapIntervals([[1, 3], [2, 4], [3, 5], [1, 5]]))  # 2
