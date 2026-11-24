Implement an in-memory key-value store whose changes can be grouped into **nested transactions** that are later committed or rolled back. Keys are strings and values are non-negative integers.

- `KVStore()` creates an empty store with no open transaction.
- `set(key, value)` sets `key` to `value`, replacing any previous value.
- `get(key) -> int` returns the current value of `key`, or `-1` if it is not set.
- `unset(key)` removes `key`. Does nothing if `key` is not set.
- `count(value) -> int` returns how many keys currently have exactly this value.
- `begin()` opens a new transaction, nested inside any transactions that are already open.
- `rollback() -> bool` undoes every `set` and `unset` made since the **innermost** open transaction began, then closes that transaction; the store returns to exactly the state it had when that `begin` was called. Returns `false` and does nothing if no transaction is open.
- `commit() -> bool` closes the **innermost** open transaction, keeping its changes. If an outer transaction is still open, those changes now belong to it: rolling back the outer transaction later undoes them too. Returns `false` and does nothing if no transaction is open.

Reads (`get`, `count`) always see the latest state, including uncommitted changes. Outside any transaction, changes are permanent.

**Example**

```
KVStore db
db.set("a", 10)
db.begin()
db.set("a", 20)
db.set("b", 20)
db.count(20)        -> 2
db.begin()
db.unset("a")
db.get("a")         -> -1
db.rollback()       -> true     inner transaction undone: a = 20 again
db.get("a")         -> 20
db.commit()         -> true     outer transaction closed, changes kept
db.rollback()       -> false    nothing open
db.get("a")         -> 20
db.count(10)        -> 0
```

**Constraints**

- Keys are 1 to 10 lowercase letters; `0 <= value <= 10^9`.
- Transactions nest up to `10^4` deep.
- At most `10^5` calls in total per test.
- `get`, `set`, `unset` and `count` should be O(1) on average. `rollback` and `commit` may cost time proportional to the number of keys changed in the transaction being closed, but not to the total number of keys in the store.
