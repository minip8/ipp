class Solution:
    def carPooling(self, trips: list[list[int]], capacity: int) -> bool:
        events = []
        for p, start, end in trips:
            events.append((start, p))
            events.append((end, -p))
        events.sort()  # at equal positions the negative (drop-off) sorts first
        load = 0
        for _, change in events:
            load += change
            if load > capacity:
                return False
        return True


if __name__ == "__main__":
    print(Solution().carPooling([[2, 1, 5], [3, 3, 7]], 4))  # False
