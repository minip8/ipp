from collections import defaultdict


class Solution:
    def subarraySum(self, nums: list[int], k: int) -> int:
        seen = defaultdict(int)
        seen[0] = 1
        prefix = count = 0
        for x in nums:
            prefix += x
            count += seen[prefix - k]
            seen[prefix] += 1
        return count


if __name__ == "__main__":
    print(Solution().subarraySum([1, 2, 3, -2, 2], 3))  # 4
