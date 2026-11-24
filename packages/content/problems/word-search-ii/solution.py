class Solution:
    def findWords(self, board: list[str], words: list[str]) -> list[str]:
        # Trie of dicts; the key "$" holds the complete word at its terminal node.
        root: dict = {}
        for w in words:
            node = root
            for ch in w:
                node = node.setdefault(ch, {})
            node["$"] = w

        grid = [list(row) for row in board]
        R, C = len(grid), len(grid[0])
        found: list[str] = []

        def dfs(r: int, c: int, parent: dict) -> None:
            ch = grid[r][c]
            node = parent.get(ch)
            if node is None:
                return
            word = node.pop("$", None)
            if word is not None:
                found.append(word)          # popped, so it is reported once
            grid[r][c] = "#"
            if r > 0: dfs(r - 1, c, node)
            if r + 1 < R: dfs(r + 1, c, node)
            if c > 0: dfs(r, c - 1, node)
            if c + 1 < C: dfs(r, c + 1, node)
            grid[r][c] = ch
            if not node:                    # nothing left below: prune the branch
                del parent[ch]

        for r in range(R):
            for c in range(C):
                dfs(r, c, root)
        return found


if __name__ == "__main__":
    print(Solution().findWords(["cats", "rohe", "bnep"],
                               ["cat", "cats", "hat", "the", "hen", "rob", "orb", "peep"]))
