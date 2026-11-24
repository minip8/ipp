class Solution:
    def criticalConnections(self, n: int, connections: list[list[int]]) -> list[list[int]]:
        adj: list[list[int]] = [[] for _ in range(n)]
        for a, b in connections:
            adj[a].append(b)
            adj[b].append(a)
        tin = [-1] * n
        low = [0] * n
        bridges = []
        timer = 0
        # Iterative DFS: stack of (vertex, parent, index of next neighbour to try).
        tin[0] = low[0] = timer
        timer += 1
        stack = [(0, -1, 0)]
        while stack:
            v, parent, i = stack[-1]
            if i < len(adj[v]):
                stack[-1] = (v, parent, i + 1)
                u = adj[v][i]
                if u == parent:
                    continue
                if tin[u] == -1:
                    tin[u] = low[u] = timer
                    timer += 1
                    stack.append((u, v, 0))
                else:
                    low[v] = min(low[v], tin[u])
            else:
                stack.pop()
                if parent != -1:
                    low[parent] = min(low[parent], low[v])
                    if low[v] > tin[parent]:
                        bridges.append([parent, v])
        return bridges


if __name__ == "__main__":
    print(Solution().criticalConnections(5, [[0, 1], [1, 2], [2, 0], [1, 3], [3, 4]]))
