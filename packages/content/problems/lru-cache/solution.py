class _Node:
    __slots__ = ("key", "value", "prev", "next")

    def __init__(self, key: int = 0, value: int = 0) -> None:
        self.key, self.value = key, value
        self.prev = self.next = None


class LRUCache:
    """Hash map to nodes of a doubly linked list; most recently used next to the head sentinel."""

    def __init__(self, capacity: int) -> None:
        self.cap = capacity
        self.nodes: dict[int, _Node] = {}
        self.head, self.tail = _Node(), _Node()
        self.head.next, self.tail.prev = self.tail, self.head

    def _unlink(self, node: _Node) -> None:
        node.prev.next, node.next.prev = node.next, node.prev

    def _push_front(self, node: _Node) -> None:
        node.prev, node.next = self.head, self.head.next
        self.head.next.prev = node
        self.head.next = node

    def get(self, key: int) -> int:
        node = self.nodes.get(key)
        if node is None:
            return -1
        self._unlink(node)
        self._push_front(node)
        return node.value

    def put(self, key: int, value: int) -> None:
        node = self.nodes.get(key)
        if node is not None:
            node.value = value
            self._unlink(node)
            self._push_front(node)
            return
        node = _Node(key, value)
        self.nodes[key] = node
        self._push_front(node)
        if len(self.nodes) > self.cap:
            lru = self.tail.prev
            self._unlink(lru)
            del self.nodes[lru.key]


if __name__ == "__main__":
    c = LRUCache(2)
    c.put(1, 10)
    c.put(2, 20)
    print(c.get(1))  # 10
    c.put(3, 30)
    print(c.get(2))  # -1
