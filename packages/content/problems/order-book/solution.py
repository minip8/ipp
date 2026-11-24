import heapq
from collections import deque


class OrderBook:
    """Price levels: price -> deque of [id, seq] plus a volume counter; best prices via heaps
    with lazy deletion of empty levels. Orders: id -> [side, price, remaining, seq].
    Cancel and loss-of-priority modify mark queue entries stale (seq mismatch) instead of
    searching the deque, so both are O(1) amortized."""

    def __init__(self) -> None:
        self.levels = {"buy": {}, "sell": {}}   # side -> price -> deque[(id, seq)]
        self.volume = {"buy": {}, "sell": {}}   # side -> price -> remaining qty
        self.heaps = {"buy": [], "sell": []}    # buy heap stores -price
        self.orders: dict[int, list] = {}       # resting orders only
        self.used: set[int] = set()
        self.seq = 0
        self.fills: list[list[int]] = []

    def _best(self, side: str) -> int:
        heap, vol = self.heaps[side], self.volume[side]
        while heap:
            p = -heap[0] if side == "buy" else heap[0]
            if vol.get(p, 0) > 0:
                return p
            heapq.heappop(heap)                 # level emptied earlier
            vol.pop(p, None)
            self.levels[side].pop(p, None)
        return -1

    def _rest(self, id: int, side: str, price: int, qty: int) -> None:
        self.seq += 1
        self.orders[id] = [side, price, qty, self.seq]
        if price not in self.levels[side]:
            self.levels[side][price] = deque()
            self.volume[side][price] = 0
            heapq.heappush(self.heaps[side], -price if side == "buy" else price)
        self.levels[side][price].append((id, self.seq))
        self.volume[side][price] += qty

    def addOrder(self, id: int, side: str, price: int, qty: int) -> int:
        self.fills = []
        if price <= 0 or qty <= 0 or id in self.used:
            return -1
        self.used.add(id)
        other = "sell" if side == "buy" else "buy"
        remaining = qty
        while remaining > 0:
            best = self._best(other)
            if best == -1 or (side == "buy" and best > price) or (side == "sell" and best < price):
                break
            queue = self.levels[other][best]
            while remaining > 0 and queue:
                rid, rseq = queue[0]
                order = self.orders.get(rid)
                if order is None or order[3] != rseq:
                    queue.popleft()             # stale entry (cancelled or re-queued)
                    continue
                take = min(remaining, order[2])
                remaining -= take
                order[2] -= take
                self.volume[other][best] -= take
                self.fills.append([rid, best, take])
                if order[2] == 0:
                    queue.popleft()
                    del self.orders[rid]
        if remaining > 0:
            self._rest(id, side, price, remaining)
        return qty - remaining

    def cancel(self, id: int) -> bool:
        order = self.orders.pop(id, None)
        if order is None:
            return False
        side, price, rem, _ = order
        self.volume[side][price] -= rem
        return True

    def modify(self, id: int, newQty: int) -> bool:
        order = self.orders.get(id)
        if order is None or newQty <= 0:
            return False
        side, price, rem, _ = order
        if newQty <= rem:
            order[2] = newQty
            self.volume[side][price] -= rem - newQty
        else:
            del self.orders[id]
            self.volume[side][price] -= rem
            self._rest(id, side, price, newQty)
        return True

    def bestBid(self) -> int:
        return self._best("buy")

    def bestAsk(self) -> int:
        return self._best("sell")

    def volumeAt(self, side: str, price: int) -> int:
        return self.volume[side].get(price, 0)

    def lastFills(self) -> list[list[int]]:
        return [list(f) for f in self.fills]


if __name__ == "__main__":
    b = OrderBook()
    print(b.addOrder(1, "sell", 101, 5), b.addOrder(2, "sell", 100, 3), b.addOrder(3, "sell", 101, 4))
    print(b.addOrder(4, "buy", 101, 10), b.lastFills(), b.bestAsk())  # 10 [[2,100,3],[1,101,5],[3,101,2]] 101
