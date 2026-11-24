**What this is testing**
A warm-up: careful validation, atomicity (check everything before mutating anything), 1-based vs 0-based indexing, and integer width. Use it to see how the candidate structures small code and tests their own edge cases. Spend the remaining time on the follow-ups, which is where the real discussion is.

**Approach**
- Store balances in an array of 64-bit integers. A helper `valid(account)` checks `1 <= account <= n`. Each operation validates first, then mutates. O(1) per call.

**Common wrong turns**
- 32-bit `int` balances in C++/Java: opening balances go up to 10^12.
- Mutating before validating, e.g. `transfer` subtracting from the source and then discovering the destination is invalid (non-atomic).
- Off-by-one: treating account `n` as invalid or account `0` as valid.
- Negative account numbers indexing the array (Python: `balance[-1]` silently reads the last account!).
- Rejecting a withdrawal of exactly the whole balance (`<` vs `<=`).
- Self-transfer implemented as "subtract then add" is fine; implemented with a pre-read of both balances and two writes can lose money.

**Hint ladder**
1. What has to be true for each operation to be allowed? List the checks before writing code.
2. What happens if you change one balance and then a later check fails?
3. What type are the balances, and what is their largest value?
4. What does `balances[-1]` do in Python, and what does it do in C++?

**Follow-ups**
- Make it thread-safe. With one lock per account, how do you avoid deadlock in `transfer(a, b)` running concurrently with `transfer(b, a)`? (lock ordering by account id; `std::scoped_lock`)
- Money as floating point: why not? (use integer cents or a decimal type)
- Add a transaction history and `getStatement(account)`; add scheduled payments or overdraft limits.
- Persist it: what happens if the process crashes between the two writes of a transfer? (write-ahead log, idempotency keys)
- Top-k accounts by total outgoing amount (heap or ordered set) — a common follow-on in multi-part OAs.
