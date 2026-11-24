from collections import deque


class Solution:
    def validPath(self, n: int, edges: list[list[int]], source: int, destination: int) -> bool:
        if source == destination:
            return True
        adj: list[list[int]] = [[] for _ in range(n)]
        for u, v in edges:
            adj[u].append(v)
            adj[v].append(u)
        seen = [False] * n
        seen[source] = True
        queue = deque([source])
        while queue:
            u = queue.popleft()
            for v in adj[u]:
                if v == destination:
                    return True
                if not seen[v]:
                    seen[v] = True
                    queue.append(v)
        return False


if __name__ == "__main__":
    print(Solution().validPath(4, [[0, 1], [1, 2], [3, 3]], 0, 2))  # True
    print(Solution().validPath(5, [[0, 1], [2, 3], [3, 4]], 1, 4))  # False
