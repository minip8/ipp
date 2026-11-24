**Approaches**
- Brute force: a map timestamp -> price; `maximum`/`minimum` scan all values. O(n) per query.
- Ordered multiset of prices (C++ `std::multiset`, Java `TreeMap<price, count>`): on update, if the timestamp existed, erase **one** copy of its old price, then insert the new one. All operations O(log n). Track the latest timestamp separately.
- Two heaps with lazy deletion (common in Python): push `(price, timestamp)` into a max-heap and a min-heap on every update. On a query, pop from the top while the entry's price no longer matches `prices[timestamp]` (it was corrected). Amortised O(log n).
- `current()`: keep `latest = max(latest, timestamp)` and look up `prices[latest]`.

**Common wrong turns**
- `current()` returning the price from the most recent *call* rather than the largest timestamp (test `s1`, `h-out-of-order`).
- Multiset: `erase(oldPrice)` by value removes **all** copies of that price — must erase a single iterator (`erase(find(old))`). Test `h-duplicate-prices`.
- Lazy heaps: validating only the timestamp, not the price — a timestamp corrected back to the same price, or corrected twice, can make stale entries look valid if checked carelessly. Checking `prices[ts] == price` is correct even with stale duplicates, because the duplicate carries the same (true) value.
- Never removing the old price on a correction.

**Hint ladder**
1. What has to happen to the old price when a timestamp is corrected?
2. Which structure gives you the max and min of a changing collection that also supports deleting an arbitrary value?
3. Either an ordered multiset of prices (remove exactly one copy of the old price), or heaps that ignore entries which no longer match the current price for their timestamp.
4. Keep the latest timestamp in a variable and the price per timestamp in a hash map for `current()`.

**Follow-ups**
- Lazy deletion: how big can the heaps grow? When would you rebuild them?
- Rolling max/min over the last W seconds (monotonic deque, assuming in-order data).
- Many symbols: per-symbol state, memory layout, contention.
- In a real feed, how do you detect and handle late or duplicated messages (sequence numbers, gap detection)?
