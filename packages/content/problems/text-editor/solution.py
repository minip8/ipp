class TextEditor:
    """Two stacks: `left` = text before the cursor, `right` = text after it, reversed."""

    def __init__(self) -> None:
        self.left: list[str] = []
        self.right: list[str] = []

    def addText(self, text: str) -> None:
        self.left.extend(text)

    def deleteText(self, k: int) -> int:
        k = min(k, len(self.left))
        if k:
            del self.left[-k:]
        return k

    def _tail(self) -> str:
        return "".join(self.left[-10:])

    def cursorLeft(self, k: int) -> str:
        for _ in range(min(k, len(self.left))):
            self.right.append(self.left.pop())
        return self._tail()

    def cursorRight(self, k: int) -> str:
        for _ in range(min(k, len(self.right))):
            self.left.append(self.right.pop())
        return self._tail()


if __name__ == "__main__":
    e = TextEditor()
    e.addText("interview")
    print(e.deleteText(4))  # 4
    e.addText("nal")
    print(e.cursorLeft(3))  # inter
    e.addText("x")
    print(e.cursorRight(100))  # interxnal
