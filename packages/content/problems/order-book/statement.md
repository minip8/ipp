Implement the matching engine for a single traded instrument. Traders send **limit orders**: "buy up to `qty` units at a price of at most `price`" or "sell up to `qty` units at a price of at least `price`". Orders that cannot be matched immediately wait in the **book** until they are matched later or cancelled.

### Matching rules (price-time priority)

When a new order arrives it first trades against resting orders on the opposite side:

- A **buy** at price `p` can trade with any resting **sell** whose price is `<= p`. It always takes the **lowest-priced** sell first; among sells at the same price, the one that has been resting **longest** goes first.
- A **sell** at price `p` can trade with any resting **buy** whose price is `>= p`, taking the **highest-priced** buy first, then the oldest at that price.
- Each trade (a *fill*) is for `min(incoming remaining, resting remaining)` units and happens at the **resting order's price**. A resting order whose remaining quantity reaches 0 leaves the book.
- Matching continues until the incoming order is fully filled or no resting order on the other side is acceptable. Any remaining quantity of the incoming order then **rests** in the book at its own price, behind every order already resting at that price on that side.

### Methods

- `OrderBook()` — an empty book.
- `addOrder(id, side, price, qty) -> int` — submits a new order. `side` is `"buy"` or `"sell"`. Returns the total quantity of the incoming order filled immediately (0 if nothing traded).
  The order is **rejected** — return `-1`, change nothing — if `price <= 0`, `qty <= 0`, or `id` has been used by any earlier accepted order (even one that has since been filled or cancelled).
- `cancel(id) -> bool` — if order `id` is resting in the book, remove it (whatever quantity remains) and return `true`. Otherwise (unknown, already fully filled, already cancelled) return `false`.
- `modify(id, newQty) -> bool` — changes the remaining quantity of resting order `id` to `newQty`. Returns `false` and changes nothing if the order is not resting or `newQty <= 0`. Otherwise:
  - if `newQty <= ` its current remaining quantity, the order **keeps its place** in the queue;
  - if `newQty >` its current remaining quantity, the order **loses its place**: it moves to the back of the queue at its price, as if it had just arrived (it does not match against anything — its price did not change).
  Returns `true` in both cases. A modify never triggers trading.
- `bestBid() -> int` — the highest price of any resting buy, or `-1` if there is none.
- `bestAsk() -> int` — the lowest price of any resting sell, or `-1` if there is none.
- `volumeAt(side, price) -> int` — total remaining quantity of resting orders on `side` at exactly `price` (0 if none).
- `lastFills() -> list of [restingId, price, qty]` — the fills produced by the **most recent `addOrder` call**, in the order they happened. Empty if that call traded nothing or was rejected, or if `addOrder` has never been called. `cancel` and `modify` do not change it.

### Example

```
OrderBook b
b.addOrder(1, "sell", 101, 5)   -> 0        book: sells {101: [#1 x5]}
b.addOrder(2, "sell", 100, 3)   -> 0        sells {100: [#2 x3], 101: [#1 x5]}
b.addOrder(3, "sell", 101, 4)   -> 0        sells {100: [#2 x3], 101: [#1 x5, #3 x4]}
b.addOrder(4, "buy", 101, 10)   -> 10       fills #2 (3 @ 100), then #1 (5 @ 101), then #3 (2 @ 101)
b.lastFills()                   -> [[2,100,3],[1,101,5],[3,101,2]]
b.bestAsk()                     -> 101      #3 still has 2 left
b.addOrder(5, "buy", 99, 7)     -> 0        rests: bids {99: [#5 x7]}
b.bestBid()                     -> 99
b.addOrder(4, "buy", 50, 1)     -> -1       id 4 was already used
b.modify(5, 9)                  -> true
b.volumeAt("buy", 99)           -> 9
b.cancel(5)                     -> true
b.bestBid()                     -> -1
```

### Constraints

- `1 <= id <= 10^9` for valid orders (rejected calls may use any int); `side` is always `"buy"` or `"sell"`.
- Valid prices and quantities are at most `10^4`.
- At most `10^4` calls in total per test.
- Aim for `O(log P)` per price-level change (P = number of distinct price levels) plus `O(1)` per fill, and `O(1)` or `O(log P)` per `cancel`.
