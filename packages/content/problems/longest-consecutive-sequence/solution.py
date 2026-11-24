class Solution:
    def longestConsecutive(self, nums: list[int]) -> int:
        values = set(nums)
        best = 0
        for v in values:
            if v - 1 not in values:
                end = v
                while end + 1 in values:
                    end += 1
                best = max(best, end - v + 1)
        return best


if __name__ == "__main__":
    print(Solution().longestConsecutive([10, 4, 20, 1, 3, 2]))  # 4
