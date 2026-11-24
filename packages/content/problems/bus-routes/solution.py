from collections import deque


class Solution:
    def numBusesToDestination(self, routes: list[list[int]], source: int, target: int) -> int:
        if source == target:
            return 0
        buses_at: dict[int, list[int]] = {}
        for bus, stops in enumerate(routes):
            for s in stops:
                buses_at.setdefault(s, []).append(bus)
        if source not in buses_at or target not in buses_at:
            return -1
        bus_seen = [False] * len(routes)
        stop_done = {source}
        queue = deque()
        for b in buses_at[source]:
            bus_seen[b] = True
            queue.append((b, 1))
        while queue:
            bus, rides = queue.popleft()
            for s in routes[bus]:
                if s == target:
                    return rides
                if s in stop_done:
                    continue
                stop_done.add(s)
                for nb in buses_at[s]:
                    if not bus_seen[nb]:
                        bus_seen[nb] = True
                        queue.append((nb, rides + 1))
        return -1


if __name__ == "__main__":
    print(Solution().numBusesToDestination([[1, 4, 7], [3, 6, 7]], 1, 6))  # 2
