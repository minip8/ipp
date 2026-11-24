class Solution:
    def canAttendMeetings(self, intervals: list[list[int]]) -> bool:
        intervals = sorted(intervals)
        for prev, cur in zip(intervals, intervals[1:]):
            if cur[0] < prev[1]:
                return False
        return True


if __name__ == "__main__":
    print(Solution().canAttendMeetings([[9, 10], [13, 15], [10, 12]]))  # True
