class Solution:
    def majorityElement(self, nums: list[int]) -> int:
        candidate, count = None, 0
        for x in nums:
            if count == 0:
                candidate = x
            count += 1 if x == candidate else -1
        return candidate


if __name__ == "__main__":
    print(Solution().majorityElement([7, 7, 2, 2, 7, 3, 7]))  # 7
