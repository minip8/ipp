class Solution:
    def calcEquation(self, equations: list[list[str]], values: list[float], queries: list[list[str]]) -> list[float]:
        """Weighted union-find: weight[x] = x / parent[x]."""
        parent: dict[str, str] = {}
        weight: dict[str, float] = {}

        def find(x: str) -> str:
            # Iterative find with full path compression, folding weights into each node.
            path = []
            while parent[x] != x:
                path.append(x)
                x = parent[x]
            root = x
            # Walk back from the node nearest the root so each weight becomes relative to root.
            for node in reversed(path):
                p = parent[node]
                if p != root:
                    weight[node] *= weight[p]
                parent[node] = root
            return root

        for (a, b), k in zip(equations, values):
            for x in (a, b):
                if x not in parent:
                    parent[x], weight[x] = x, 1.0
            ra, rb = find(a), find(b)
            if ra != rb:
                # a = w(a) * ra, b = w(b) * rb, a / b = k  =>  ra / rb = k * w(b) / w(a)
                parent[ra] = rb
                weight[ra] = k * weight[b] / weight[a]

        out = []
        for c, d in queries:
            if c not in parent or d not in parent or find(c) != find(d):
                out.append(-1.0)
            else:
                out.append(weight[c] / weight[d])
        return out


if __name__ == "__main__":
    print(Solution().calcEquation([["usd", "eur"], ["eur", "gbp"]], [1.25, 1.2], [["usd", "gbp"], ["x", "x"]]))
