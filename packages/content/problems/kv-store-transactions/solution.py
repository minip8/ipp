from collections import defaultdict

_ABSENT = None


class KVStore:
    """Live map + value counts + a stack of undo logs (key -> value before the transaction first
    touched it, or None if absent)."""

    def __init__(self) -> None:
        self.data: dict[str, int] = {}
        self.counts: defaultdict[int, int] = defaultdict(int)
        self.logs: list[dict[str, int | None]] = []

    def _write(self, key: str, value: int | None) -> None:
        """Set (value is an int) or erase (value is None), keeping counts in step."""
        old = self.data.get(key)
        if old is not None:
            self.counts[old] -= 1
        if value is None:
            self.data.pop(key, None)
        else:
            self.data[key] = value
            self.counts[value] += 1

    def _log(self, key: str) -> None:
        if self.logs and key not in self.logs[-1]:
            self.logs[-1][key] = self.data.get(key)

    def set(self, key: str, value: int) -> None:
        self._log(key)
        self._write(key, value)

    def get(self, key: str) -> int:
        return self.data.get(key, -1)

    def unset(self, key: str) -> None:
        if key in self.data:
            self._log(key)
            self._write(key, _ABSENT)

    def count(self, value: int) -> int:
        return self.counts.get(value, 0)

    def begin(self) -> None:
        self.logs.append({})

    def rollback(self) -> bool:
        if not self.logs:
            return False
        for key, old in self.logs.pop().items():
            self._write(key, old)
        return True

    def commit(self) -> bool:
        if not self.logs:
            return False
        child = self.logs.pop()
        if self.logs:
            parent = self.logs[-1]
            for key, old in child.items():
                parent.setdefault(key, old)
        return True


if __name__ == "__main__":
    db = KVStore()
    db.set("a", 10); db.begin(); db.set("a", 20); db.set("b", 20)
    print(db.count(20))  # 2
    db.begin(); db.unset("a")
    print(db.get("a"), db.rollback(), db.get("a"))  # -1 True 20
    print(db.commit(), db.rollback(), db.get("a"), db.count(10))  # True False 20 0
