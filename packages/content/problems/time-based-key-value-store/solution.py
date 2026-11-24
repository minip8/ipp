from bisect import bisect_right


class TimeMap:
    """key -> (sorted timestamps, values); sets arrive in increasing time so appends stay sorted."""

    def __init__(self) -> None:
        self.times: dict[str, list[int]] = {}
        self.values: dict[str, list[str]] = {}

    def set(self, key: str, value: str, timestamp: int) -> None:
        self.times.setdefault(key, []).append(timestamp)
        self.values.setdefault(key, []).append(value)

    def get(self, key: str, timestamp: int) -> str:
        ts = self.times.get(key)
        if not ts:
            return ""
        i = bisect_right(ts, timestamp)  # first version strictly after `timestamp`
        return self.values[key][i - 1] if i else ""


if __name__ == "__main__":
    m = TimeMap()
    m.set("price", "100", 5)
    m.set("price", "105", 9)
    print([m.get("price", t) for t in (4, 5, 8, 9, 50)], repr(m.get("volume", 9)))
