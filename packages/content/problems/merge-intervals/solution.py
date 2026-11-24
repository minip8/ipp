class Solution:
    def merge(self, intervals: list[list[int]]) -> list[list[int]]:
        out: list[list[int]] = []
        for start, end in sorted(intervals):
            if out and start <= out[-1][1]:
                out[-1][1] = max(out[-1][1], end)
            else:
                out.append([start, end])
        return out


if __name__ == "__main__":
    print(Solution().merge([[8, 10], [1, 3], [2, 6], [15, 18]]))  # [[1, 6], [8, 10], [15, 18]]
