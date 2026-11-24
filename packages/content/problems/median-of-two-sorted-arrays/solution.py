class Solution:
    def findMedianSortedArrays(self, a: list[int], b: list[int]) -> float:
        if len(a) > len(b):
            a, b = b, a
        m, n = len(a), len(b)
        half = (m + n + 1) // 2
        lo, hi = 0, m
        inf = float("inf")
        while True:
            i = (lo + hi) // 2  # elements taken from a for the left half
            j = half - i
            a_left = a[i - 1] if i > 0 else -inf
            a_right = a[i] if i < m else inf
            b_left = b[j - 1] if j > 0 else -inf
            b_right = b[j] if j < n else inf
            if a_left > b_right:
                hi = i - 1
            elif b_left > a_right:
                lo = i + 1
            else:
                left_max = max(a_left, b_left)
                if (m + n) % 2:
                    return float(left_max)
                return (left_max + min(a_right, b_right)) / 2


if __name__ == "__main__":
    print(Solution().findMedianSortedArrays([1, 2], [3, 4]))  # 2.5
