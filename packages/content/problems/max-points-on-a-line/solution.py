from collections import Counter
from math import gcd


class Solution:
    def maxPoints(self, points: list[list[int]]) -> int:
        n = len(points)
        best = 1
        for i in range(n):
            x0, y0 = points[i]
            directions: Counter = Counter()
            for j in range(i + 1, n):
                dx, dy = points[j][0] - x0, points[j][1] - y0
                g = gcd(dx, dy)
                dx, dy = dx // g, dy // g
                if dx < 0 or (dx == 0 and dy < 0):
                    dx, dy = -dx, -dy
                directions[(dx, dy)] += 1
            if directions:
                best = max(best, 1 + max(directions.values()))
        return best


if __name__ == "__main__":
    print(Solution().maxPoints([[0, 0], [4, 2], [2, 1], [1, 3], [-2, -1], [5, 5]]))  # 4
