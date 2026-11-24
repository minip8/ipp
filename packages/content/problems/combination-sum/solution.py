class Solution:
    def combinationSum(self, candidates: list[int], target: int) -> list[list[int]]:
        cands = sorted(candidates)
        res: list[list[int]] = []
        path: list[int] = []

        def go(start: int, remaining: int) -> None:
            if remaining == 0:
                res.append(path[:])
                return
            for j in range(start, len(cands)):
                c = cands[j]
                if c > remaining:
                    break               # sorted: every later candidate is too big as well
                path.append(c)
                go(j, remaining - c)    # j, not j + 1: c may be used again
                path.pop()

        go(0, target)
        return res


if __name__ == "__main__":
    print(Solution().combinationSum([3, 4, 7], 7))
