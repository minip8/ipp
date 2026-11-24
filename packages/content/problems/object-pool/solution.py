class ObjectPool:
    """Parallel arrays per slot (value, generation, live) plus a LIFO stack of released slots
    and a high-water mark for never-used slots. Every operation is O(1)."""

    def __init__(self, capacity: int) -> None:
        self.cap = capacity
        self.values = [0] * capacity
        self.gen = [0] * capacity
        self.live = [False] * capacity
        self.free: list[int] = []     # released slots, most recent last
        self.next_fresh = 0
        self.count = 0

    def _slot(self, handle: int) -> int:
        """Slot index for a valid handle, else -1."""
        if handle < 0:
            return -1
        slot, g = handle % self.cap, handle // self.cap
        return slot if self.live[slot] and self.gen[slot] == g else -1

    def acquire(self, value: int) -> int:
        if self.free:
            slot = self.free.pop()
        elif self.next_fresh < self.cap:
            slot = self.next_fresh
            self.next_fresh += 1
        else:
            return -1
        self.values[slot] = value
        self.live[slot] = True
        self.count += 1
        return self.gen[slot] * self.cap + slot

    def get(self, handle: int) -> int:
        slot = self._slot(handle)
        return -1 if slot < 0 else self.values[slot]

    def set(self, handle: int, value: int) -> bool:
        slot = self._slot(handle)
        if slot < 0:
            return False
        self.values[slot] = value
        return True

    def release(self, handle: int) -> bool:
        slot = self._slot(handle)
        if slot < 0:
            return False
        self.live[slot] = False
        self.gen[slot] += 1
        self.free.append(slot)
        self.count -= 1
        return True

    def size(self) -> int:
        return self.count


if __name__ == "__main__":
    p = ObjectPool(3)
    print(p.acquire(10), p.acquire(20), p.release(0), p.get(0), p.release(0))  # 0 1 True -1 False
    print(p.acquire(30), p.get(3), p.acquire(40), p.acquire(50), p.size())  # 3 30 2 -1 3
