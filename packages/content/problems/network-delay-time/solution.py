import heapq


class Solution:
    def networkDelayTime(self, times: list[list[int]], n: int, k: int) -> int:
        adj: list[list[tuple[int, int]]] = [[] for _ in range(n + 1)]
        for u, v, w in times:
            adj[u].append((v, w))
        INF = float("inf")
        dist = [INF] * (n + 1)
        dist[k] = 0
        heap = [(0, k)]
        while heap:
            d, u = heapq.heappop(heap)
            if d > dist[u]:
                continue
            for v, w in adj[u]:
                nd = d + w
                if nd < dist[v]:
                    dist[v] = nd
                    heapq.heappush(heap, (nd, v))
        worst = max(dist[1:])
        return -1 if worst == INF else worst


if __name__ == "__main__":
    print(Solution().networkDelayTime([[1, 2, 4], [1, 3, 1], [3, 2, 2], [2, 4, 1]], 4, 1))  # 4
