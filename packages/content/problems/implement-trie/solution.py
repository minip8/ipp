class Trie:
    """Nodes are dicts from letter to child; the key "$" marks the end of a word."""

    def __init__(self) -> None:
        self.root: dict = {}

    def insert(self, word: str) -> None:
        node = self.root
        for ch in word:
            node = node.setdefault(ch, {})
        node["$"] = True

    def _walk(self, s: str):
        node = self.root
        for ch in s:
            node = node.get(ch)  # never creates nodes
            if node is None:
                return None
        return node

    def search(self, word: str) -> bool:
        node = self._walk(word)
        return node is not None and "$" in node

    def startsWith(self, prefix: str) -> bool:
        return self._walk(prefix) is not None


if __name__ == "__main__":
    t = Trie()
    t.insert("card")
    print(t.search("car"), t.startsWith("car"))  # False True
