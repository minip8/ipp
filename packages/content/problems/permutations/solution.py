class Solution:
    def permute(self, nums: list[int]) -> list[list[int]]:
        res: list[list[int]] = []
        a = list(nums)

        def go(i: int) -> None:
            if i == len(a):
                res.append(a[:])
                return
            for j in range(i, len(a)):
                a[i], a[j] = a[j], a[i]
                go(i + 1)
                a[i], a[j] = a[j], a[i]

        go(0)
        return res


if __name__ == "__main__":
    print(Solution().permute([1, 2, 3]))
