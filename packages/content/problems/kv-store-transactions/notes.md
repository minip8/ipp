**Approaches**
- Copy on begin: snapshot the whole map (and the value counts) on every `begin`, restore it on rollback. Easy and correct, but O(store size) per begin — explicitly ruled out by the constraints. A fine first statement if the candidate then improves it.
- Expected — undo log: keep the live map `data` and a `value -> count` map, plus a stack of transaction logs. Each log maps `key -> value before this transaction first touched it` (or "absent"). On `set`/`unset` inside a transaction, record the old value only if the key is not already in the innermost log. `rollback` replays the innermost log back into `data` (keeping counts consistent) and pops it. `commit` pops the innermost log and merges it into the parent: for each key not already in the parent's log, copy the child's old value up (the parent's entry, if present, is older and wins). Outermost commit just discards the log. All single-key operations O(1); rollback/commit O(keys touched).
- Alternative — layered overlays: each transaction holds a map of new values with tombstones; `get` walks layers from innermost outwards. Simple commit/rollback, but `get` becomes O(depth) and `count` is hard. Worth discussing why it loses here.

**Common wrong turns**
- `count` computed by scanning the map: O(n) per call.
- Forgetting to update the counts when rolling back (or double-decrementing when a key is unset that was already absent).
- Recording the old value on *every* write in a transaction instead of only the first, then restoring the wrong intermediate value (or, with a list log replayed in reverse, that works too — accept it if they replay in reverse order).
- Commit that discards the child log when an outer transaction exists: a later outer rollback then fails to undo the inner changes.
- Treating `commit` as "close all transactions" — that is a different (also common) spec; here it closes the innermost only.
- Leaving a key in the map with a sentinel value instead of erasing it, then counting it.
- `unset` of a missing key inside a transaction logging an entry that later "restores" it incorrectly (restoring "absent" to "absent" is fine if handled).

**Hint ladder**
1. Copying the whole store on `begin` works; what does it cost, and what fraction of that copy is ever needed?
2. A rollback only needs to know, for each key the transaction touched, what that key looked like before.
3. Keep a stack of "before images" (key -> previous value or absent), one per open transaction, recorded on the first touch only.
4. On commit, the inner before-images become the outer transaction's responsibility — merge them up without overwriting older entries. Keep a value -> count map updated on every change for `count`.

**Follow-ups**
- Make it durable: write-ahead log, checkpoints, crash recovery. Where does fsync go?
- Concurrent clients: isolation levels; MVCC with version numbers instead of an undo log.
- Memory with very deep nesting and huge transactions.
- `commit` closing all transactions, or savepoints with names.
