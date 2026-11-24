class UndergroundSystem:
    def __init__(self) -> None:
        self.active: dict[int, tuple[str, int]] = {}            # card -> (start station, time)
        self.stats: dict[tuple[str, str], list[int]] = {}        # (start, end) -> [total, count]

    def checkIn(self, id: int, stationName: str, t: int) -> None:
        self.active[id] = (stationName, t)

    def checkOut(self, id: int, stationName: str, t: int) -> None:
        start, t0 = self.active.pop(id)
        s = self.stats.setdefault((start, stationName), [0, 0])
        s[0] += t - t0
        s[1] += 1

    def getAverageTime(self, startStation: str, endStation: str) -> float:
        total, count = self.stats[(startStation, endStation)]
        return total / count


if __name__ == "__main__":
    u = UndergroundSystem()
    u.checkIn(1, "Bank", 3)
    u.checkIn(2, "Bank", 4)
    u.checkOut(1, "Oval", 15)
    u.checkOut(2, "Oval", 21)
    print(u.getAverageTime("Bank", "Oval"))  # 14.5
