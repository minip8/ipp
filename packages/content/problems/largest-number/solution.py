from functools import cmp_to_key


class Solution:
    def largestNumber(self, nums: list[int]) -> str:
        strs = [str(x) for x in nums]
        strs.sort(key=cmp_to_key(lambda a, b: (b + a > a + b) - (b + a < a + b)))
        return "0" if strs[0] == "0" else "".join(strs)


if __name__ == "__main__":
    print(Solution().largestNumber([3, 30, 34, 5, 9]))  # 9534330
