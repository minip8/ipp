class Solution:
    def findCheapestPrice(self, n: int, flights: list[list[int]], src: int, dst: int, k: int) -> int:
        INF = float("inf")
        cost = [INF] * n
        cost[src] = 0
        for _ in range(k + 1):
            nxt = cost[:]
            changed = False
            for u, v, p in flights:
                if cost[u] + p < nxt[v]:
                    nxt[v] = cost[u] + p
                    changed = True
            cost = nxt
            if not changed:
                break
        return -1 if cost[dst] == INF else cost[dst]


if __name__ == "__main__":
    f = [[0, 1, 100], [1, 2, 100], [2, 0, 100], [1, 3, 600], [2, 3, 200]]
    print(Solution().findCheapestPrice(4, f, 0, 3, 1))  # 700
