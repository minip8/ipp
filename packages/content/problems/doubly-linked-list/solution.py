class Node:
    __slots__ = ("val", "prev", "next")

    def __init__(self, val: int = 0) -> None:
        self.val = val
        self.prev: "Node" = self
        self.next: "Node" = self


class DoublyLinkedList:
    """Circular list around a sentinel: sentinel.next is the front, sentinel.prev the back, so
    every insertion and removal is the same four-pointer splice with no special cases."""

    def __init__(self) -> None:
        self.sent = Node()
        self.n = 0

    def _link_before(self, at: Node, value: int) -> None:
        node = Node(value)
        node.prev, node.next = at.prev, at
        at.prev.next = node
        at.prev = node
        self.n += 1

    def _unlink(self, node: Node) -> int:
        node.prev.next = node.next
        node.next.prev = node.prev
        self.n -= 1
        return node.val

    def _node(self, index: int) -> Node:
        """Node at position index (0 <= index <= n; index n is the sentinel), from the nearer end."""
        if index <= self.n // 2:
            p = self.sent.next
            for _ in range(index):
                p = p.next
        else:
            p = self.sent
            for _ in range(self.n - index):
                p = p.prev
        return p

    def pushFront(self, value: int) -> None:
        self._link_before(self.sent.next, value)

    def pushBack(self, value: int) -> None:
        self._link_before(self.sent, value)

    def popFront(self) -> int:
        return self._unlink(self.sent.next) if self.n else -1

    def popBack(self) -> int:
        return self._unlink(self.sent.prev) if self.n else -1

    def front(self) -> int:
        return self.sent.next.val if self.n else -1

    def back(self) -> int:
        return self.sent.prev.val if self.n else -1

    def get(self, index: int) -> int:
        return self._node(index).val if 0 <= index < self.n else -1

    def insert(self, index: int, value: int) -> bool:
        if not 0 <= index <= self.n:
            return False
        self._link_before(self._node(index), value)
        return True

    def erase(self, index: int) -> int:
        return self._unlink(self._node(index)) if 0 <= index < self.n else -1

    def size(self) -> int:
        return self.n

    def reverse(self) -> None:
        p = self.sent
        while True:  # swap prev and next on every node, the sentinel included
            p.prev, p.next = p.next, p.prev
            p = p.prev  # the old next
            if p is self.sent:
                break

    def toArray(self) -> list[int]:
        out, p = [], self.sent.next
        while p is not self.sent:
            out.append(p.val)
            p = p.next
        return out

    def toArrayReversed(self) -> list[int]:
        out, p = [], self.sent.prev
        while p is not self.sent:
            out.append(p.val)
            p = p.prev
        return out


if __name__ == "__main__":
    l = DoublyLinkedList()
    for v in (1, 2, 3):
        l.pushBack(v)
    l.pushFront(0)
    l.insert(2, 9)
    print(l.erase(0), l.popBack())  # 0 3
    l.reverse()
    print(l.toArray(), l.toArrayReversed())  # [2, 9, 1] [1, 9, 2]
