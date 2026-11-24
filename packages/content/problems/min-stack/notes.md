**Approaches**
- Brute force: scan the stack in `getMin`. O(n) per call — not accepted, the point is O(1).
- Expected: store, for every element, the minimum of the stack up to and including it (either pairs `(val, minSoFar)` or a second parallel stack). All operations O(1), O(n) extra space.
- Space-saving variant: a second stack that only receives `val` when `val <= currentMin`, popped when the popped value equals its top. Needs `<=`, not `<`, or duplicates of the minimum break it.
- Clever O(1)-extra-space variant: store `val - min` differences (in 64-bit) and decode on pop. Good discussion of overflow; not required.

**Common wrong turns**
- Keeping a single `min` variable: after popping the minimum you cannot recover the previous one without a scan.
- Auxiliary min stack pushed with `<` instead of `<=`: pushing 2, 2 then popping once loses the minimum.
- In C++, the difference-encoding trick overflows `int` with values near `INT_MIN`/`INT_MAX` (tests include them).
- Java: comparing `Integer` objects from two stacks with `==` (fails outside the -128..127 cache). Use `.equals` or `int`.

**Hint ladder**
1. When the current minimum is popped, what would you need to know to answer `getMin` again?
2. The answer to `getMin` depends only on the elements below and including the top. Could you precompute it when pushing?
3. Store alongside each element the minimum of everything at or below it.
4. `push` stores `min(val, previous min)`; `pop` simply discards the pair; `getMin` reads the top pair.

**Follow-ups**
- Reduce memory when the minimum rarely changes (min stack with counts: `(value, count)` pairs).
- Max stack with `popMax()` — needs a different structure (ordered map + linked list, O(log n)).
- Min queue (two min-stacks, amortised O(1)) — used for sliding window minima.
- What happens to the difference-encoding trick with 64-bit inputs?
