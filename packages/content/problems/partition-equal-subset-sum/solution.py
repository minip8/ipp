class Solution:
    def canPartition(self, nums: list[int]) -> bool:
        total = sum(nums)
        if total % 2:
            return False
        half = total // 2
        reach = [True] + [False] * half  # reach[s]: some subset of the items so far sums to s
        for x in nums:
            for s in range(half, x - 1, -1):  # downward: each item used at most once
                if reach[s - x]:
                    reach[s] = True
            if reach[half]:
                return True
        return reach[half]


if __name__ == "__main__":
    print(Solution().canPartition([2, 3, 4, 5]), Solution().canPartition([1, 2, 5]))  # True False
