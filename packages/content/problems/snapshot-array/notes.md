**Approaches**
- Brute force: copy the array on each `snap`. O(length) per snap, O(length * snaps) memory — with 5*10^4 of each that is 2.5*10^9 ints. Test `h-many-snaps-long-array` makes this time out or run out of memory.
- Copy only changed entries per snap (a diff map per snapshot): `get` must then search backwards through snapshots — O(snaps) per get.
- Expected: per index, a history list of (snapId, value) pairs, appended on `set` (overwrite the last pair if it has the current snap id). `get(i, s)` binary-searches index i's history for the last pair with snapId `<= s`. `set` O(1), `snap` O(1), `get` O(log k), memory O(length + sets).

**Common wrong turns**
- Recording a `set` under the id of the *last taken* snapshot instead of the *next* one (the live array becomes snapshot `snapCount` when snap is next called).
- Several sets to the same index between snaps: either overwrite the last entry or make the binary search pick the *last* of equal snap ids (`upper_bound`, not `lower_bound`).
- Forgetting the implicit initial value 0 for indices never set, or set only after the queried snapshot.
- Setting a value then setting it back to 0: must store the 0 explicitly, not treat 0 as "unset".

**Hint ladder**
1. Between two snapshots, how many elements typically change? Do unchanged ones need copying?
2. Think per index: what does the history of a single element look like over time?
3. Store, for each index, the list of (snap id when written, value). It is sorted by snap id automatically.
4. A query for snapshot s wants the last entry with id `<= s` — binary search; if none, the answer is 0.

**Follow-ups**
- Persistent data structures: path-copying segment tree gives O(log n) set/get with full history — when is it preferable?
- Delete old snapshots / garbage-collect history.
- Copy-on-write pages (how `fork()` or database MVCC does it) — snapshot cost proportional to pages touched.
- Memory layout in C++: vector of small vectors vs one big log array with per-index chains.
