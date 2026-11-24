class Solution:
    def countSmaller(self, nums: list[int]) -> list[int]:
        offset = 10**4 + 1          # maps values to 1..20001 for the Fenwick tree
        size = 2 * 10**4 + 2
        tree = [0] * (size + 1)
        out = [0] * len(nums)
        for i in range(len(nums) - 1, -1, -1):
            v = nums[i] + offset
            j, count = v - 1, 0     # how many inserted values are <= v - 1
            while j > 0:
                count += tree[j]
                j -= j & -j
            out[i] = count
            while v <= size:
                tree[v] += 1
                v += v & -v
        return out


if __name__ == "__main__":
    print(Solution().countSmaller([5, 2, 6, 1]))  # [2, 1, 1, 0]
