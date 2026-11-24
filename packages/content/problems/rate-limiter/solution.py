from collections import deque


class RateLimiter:
    """Sliding window log: per client, a queue of accepted request times inside the window."""

    def __init__(self, maxRequests: int, windowSeconds: int) -> None:
        self.max = maxRequests
        self.window = windowSeconds
        self.log: dict[int, deque[int]] = {}

    def allow(self, clientId: int, timestamp: int) -> bool:
        q = self.log.setdefault(clientId, deque())
        while q and q[0] <= timestamp - self.window:
            q.popleft()
        if len(q) >= self.max:
            return False
        q.append(timestamp)
        return True


if __name__ == "__main__":
    r = RateLimiter(2, 10)
    calls = [(1, 1), (1, 5), (1, 8), (2, 8), (1, 11), (1, 14), (1, 15)]
    print([r.allow(c, t) for c, t in calls])  # [True, True, False, True, True, False, True]
