class Solution:
    def subsets(self, nums: list[int]) -> list[list[int]]:
        res: list[list[int]] = []
        cur: list[int] = []

        def go(i: int) -> None:
            if i == len(nums):
                res.append(cur[:])
                return
            go(i + 1)              # skip nums[i]
            cur.append(nums[i])    # take nums[i]
            go(i + 1)
            cur.pop()

        go(0)
        return res


if __name__ == "__main__":
    print(Solution().subsets([1, 2, 3]))
