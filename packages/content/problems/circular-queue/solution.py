class CircularQueue:
    def __init__(self, capacity: int) -> None:
        self.buf = [0] * capacity
        self.head = 0  # index of the front element
        self.count = 0

    def enqueue(self, value: int) -> bool:
        if self.count == len(self.buf):
            return False
        self.buf[(self.head + self.count) % len(self.buf)] = value
        self.count += 1
        return True

    def dequeue(self) -> bool:
        if self.count == 0:
            return False
        self.head = (self.head + 1) % len(self.buf)
        self.count -= 1
        return True

    def front(self) -> int:
        return self.buf[self.head] if self.count else -1

    def rear(self) -> int:
        return self.buf[(self.head + self.count - 1) % len(self.buf)] if self.count else -1

    def isEmpty(self) -> bool:
        return self.count == 0

    def isFull(self) -> bool:
        return self.count == len(self.buf)


if __name__ == "__main__":
    q = CircularQueue(3)
    print([q.enqueue(v) for v in (1, 2, 3, 4)])  # [True, True, True, False]
    q.dequeue()
    q.enqueue(4)
    print(q.front(), q.rear())  # 2 4
