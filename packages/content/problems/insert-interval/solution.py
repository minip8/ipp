class Solution:
    def insert(self, intervals: list[list[int]], newInterval: list[int]) -> list[list[int]]:
        start, end = newInterval
        out: list[list[int]] = []
        i, n = 0, len(intervals)
        while i < n and intervals[i][1] < start:
            out.append(list(intervals[i]))
            i += 1
        while i < n and intervals[i][0] <= end:
            start = min(start, intervals[i][0])
            end = max(end, intervals[i][1])
            i += 1
        out.append([start, end])
        out.extend(list(iv) for iv in intervals[i:])
        return out


if __name__ == "__main__":
    print(Solution().insert([[1, 2], [5, 7], [9, 12]], [6, 9]))  # [[1, 2], [5, 12]]
