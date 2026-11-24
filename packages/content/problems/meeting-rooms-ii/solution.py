class Solution:
    def minMeetingRooms(self, intervals: list[list[int]]) -> int:
        starts = sorted(s for s, _ in intervals)
        ends = sorted(e for _, e in intervals)
        in_use = best = j = 0
        for s in starts:
            while ends[j] <= s:  # free every room whose meeting has ended by now
                in_use -= 1
                j += 1
            in_use += 1
            best = max(best, in_use)
        return best


if __name__ == "__main__":
    print(Solution().minMeetingRooms([[0, 30], [5, 10], [15, 20]]))  # 2
