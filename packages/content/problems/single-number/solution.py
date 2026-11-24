from functools import reduce
from operator import xor


class Solution:
    def singleNumber(self, nums: list[int]) -> int:
        return reduce(xor, nums, 0)


if __name__ == "__main__":
    print(Solution().singleNumber([5, -2, 9, 9, 5]))  # -2
