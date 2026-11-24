from collections import OrderedDict, defaultdict


class LFUCache:
    """key -> [value, count]; count -> OrderedDict of keys (oldest use first); min_count."""

    def __init__(self, capacity: int) -> None:
        self.cap = capacity
        self.entries: dict[int, list[int]] = {}
        self.buckets: defaultdict[int, OrderedDict] = defaultdict(OrderedDict)
        self.min_count = 0

    def _touch(self, key: int) -> None:
        entry = self.entries[key]
        c = entry[1]
        bucket = self.buckets[c]
        del bucket[key]
        if not bucket:
            del self.buckets[c]
            if self.min_count == c:
                self.min_count = c + 1
        entry[1] = c + 1
        self.buckets[c + 1][key] = None

    def get(self, key: int) -> int:
        if key not in self.entries:
            return -1
        self._touch(key)
        return self.entries[key][0]

    def put(self, key: int, value: int) -> None:
        if key in self.entries:
            self.entries[key][0] = value
            self._touch(key)
            return
        if len(self.entries) >= self.cap:
            bucket = self.buckets[self.min_count]
            victim, _ = bucket.popitem(last=False)
            if not bucket:
                del self.buckets[self.min_count]
            del self.entries[victim]
        self.entries[key] = [value, 1]
        self.buckets[1][key] = None
        self.min_count = 1


if __name__ == "__main__":
    c = LFUCache(2)
    c.put(1, 10)
    c.put(2, 20)
    print(c.get(1))  # 10
    c.put(3, 30)
    print(c.get(2))  # -1
    print(c.get(3))  # 30
    c.put(4, 40)
    print(c.get(1), c.get(3), c.get(4))  # -1 30 40
