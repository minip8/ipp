from bisect import bisect_left


class Solution:
    def lengthOfLIS(self, nums: list[int]) -> int:
        tails: list[int] = []  # tails[k] = smallest tail of an increasing subsequence of length k+1
        for x in nums:
            i = bisect_left(tails, x)
            if i == len(tails):
                tails.append(x)
            else:
                tails[i] = x
        return len(tails)


if __name__ == "__main__":
    print(Solution().lengthOfLIS([4, 1, 8, 2, 3, 9, 5]))  # 4
