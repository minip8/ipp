class Solution:
    def minCostConnectPoints(self, points: list[list[int]]) -> int:
        """Dense Prim: O(n^2) time, O(n) space."""
        n = len(points)
        INF = float("inf")
        dist = [INF] * n
        in_tree = [False] * n
        dist[0] = 0
        total = 0
        for _ in range(n):
            u, best = -1, INF
            for v in range(n):
                if not in_tree[v] and dist[v] < best:
                    u, best = v, dist[v]
            in_tree[u] = True
            total += best
            ux, uy = points[u]
            for v in range(n):
                if not in_tree[v]:
                    d = abs(points[v][0] - ux) + abs(points[v][1] - uy)
                    if d < dist[v]:
                        dist[v] = d
        return total


if __name__ == "__main__":
    print(Solution().minCostConnectPoints([[0, 0], [2, 2], [3, 10], [5, 2], [7, 0]]))  # 20
