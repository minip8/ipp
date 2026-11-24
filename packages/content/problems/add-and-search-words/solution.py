class WordDictionary:
    """Trie of dicts; "$" marks the end of a word. '.' in a pattern branches over all children."""

    def __init__(self) -> None:
        self.root: dict = {}

    def addWord(self, word: str) -> None:
        node = self.root
        for ch in word:
            node = node.setdefault(ch, {})
        node["$"] = True

    def search(self, pattern: str) -> bool:
        n = len(pattern)

        def dfs(node: dict, i: int) -> bool:
            while i < n:
                ch = pattern[i]
                if ch == ".":
                    return any(k != "$" and dfs(child, i + 1) for k, child in node.items())
                node = node.get(ch)
                if node is None:
                    return False
                i += 1
            return "$" in node

        return dfs(self.root, 0)


if __name__ == "__main__":
    d = WordDictionary()
    for w in ("bad", "dad", "mad"):
        d.addWord(w)
    print(d.search("pad"), d.search(".ad"), d.search("b.."), d.search("b."))  # False True True False
