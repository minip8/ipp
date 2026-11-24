A market data feed sends price records for one stock as `(timestamp, price)` pairs. Records can arrive **out of order**, and a later record for a timestamp that was already seen is a **correction**: it replaces the earlier price for that timestamp.

- `StockPrice()` creates an empty record.
- `update(timestamp, price)` sets the price at `timestamp` to `price`, replacing any previous price for that timestamp.
- `current()` returns the price at the **latest timestamp** seen so far (the largest timestamp, not the most recent call).
- `maximum()` returns the highest price among all timestamps, using the corrected prices.
- `minimum()` returns the lowest price among all timestamps, using the corrected prices.

`current`, `maximum` and `minimum` are only called after at least one `update`.

**Example**

```
StockPrice s
s.update(1, 10)
s.update(2, 5)
s.current()    -> 5       timestamp 2 is the latest
s.maximum()    -> 10
s.update(1, 3)            correction: timestamp 1 is now 3, the old 10 is gone
s.maximum()    -> 5
s.update(4, 2)
s.minimum()    -> 2
s.update(3, 8)            arrives late; timestamp 4 is still the latest
s.current()    -> 2
s.maximum()    -> 8
```

**Constraints**

- `1 <= timestamp, price <= 10^9`
- At most `10^5` calls per test.
