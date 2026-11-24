class Solution:
    def validTree(self, n: int, edges: list[list[int]]) -> bool:
        if len(edges) != n - 1:
            return False
        parent = list(range(n))

        def find(x: int) -> int:
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x

        for a, b in edges:
            ra, rb = find(a), find(b)
            if ra == rb:
                return False  # cycle; with n - 1 edges this also means disconnected
            parent[ra] = rb
        return True


if __name__ == "__main__":
    print(Solution().validTree(5, [[0, 1], [0, 2], [0, 3], [1, 4]]))  # True
