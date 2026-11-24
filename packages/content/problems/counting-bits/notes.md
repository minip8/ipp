**Approaches**
- Per number: count bits by shifting (O(log i) each) or Kernighan's `x &= x - 1` (O(popcount)). O(n log n) overall. Fine to start with.
- Built-in popcount (`__builtin_popcount`, `int.bit_count()`) — acceptable in practice, but ask for the idea behind O(n).
- Expected: reuse earlier answers.
  - `ans[i] = ans[i >> 1] + (i & 1)` — drop the lowest bit.
  - `ans[i] = ans[i & (i - 1)] + 1` — drop the lowest *set* bit.
  - `ans[i] = ans[i - highestPowerOfTwo] + 1`.
  All O(n) time, O(1) besides the output.

**Common wrong turns**
- Returning length `n` instead of `n + 1`; `n = 0` must give `[0]`.
- Using `ans[i - 1] + 1` (wrong whenever `i` carries, e.g. 3 -> 4).
- Building binary strings (`bin(i).count("1")`) — works, but it's the slow route; ask about cost.

**Hint ladder**
1. How does the binary form of `i` relate to the binary form of `i / 2`?
2. You are filling the array in increasing order — which earlier entries are already known when you reach `i`?
3. Express `ans[i]` as one earlier entry plus 0 or 1.

**Follow-ups**
- Why does `x & (x - 1)` clear the lowest set bit?
- How is popcount done in hardware / with SWAR bit tricks for a single 64-bit word?
- Sum of popcounts from 0 to n for n up to 10^18 (count per bit position, O(log n)).
