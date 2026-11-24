**Approaches**
- Expected: a single left-to-right scan as a tiny state machine (spaces -> optional sign -> digits). Accumulate digits while checking for overflow **before** it happens: if `result > (INT_MAX - d) / 10`, clamp and stop. O(n) time, O(1) space.
- Alternative overflow handling: accumulate in a 64-bit integer and stop/clamp once the magnitude exceeds 2^31 (must stop early — very long digit strings overflow 64 bits too).

**Common wrong turns**
- Overflow in the accumulator itself (C++ signed overflow is UB) — e.g. 200 digits of `9` overflow even `long long`.
- Asymmetric bounds: the negative limit is one larger in magnitude (`"-2147483648"` is valid and must not be clamped to `-2147483647`).
- Trimming *all* whitespace (tabs/newlines) or skipping spaces after the sign.
- Accepting `"+-5"` or `"-+5"`.
- Treating `'.'` as part of the number (`"3.14"` -> 3).
- Empty or all-space strings.

**Hint ladder**
1. Write the phases down in order: what can appear first, what next, and when do you stop?
2. While accumulating digits, how do you know the *next* step would overflow, without overflowing?
3. Compare against `INT_MAX / 10` (and the last digit) before multiplying, and pick the clamp based on the sign.

**Follow-ups**
- Parse 64-bit integers, or arbitrary bases (with prefixes like `0x`).
- Parse floating point (`"1.5e-3"`) — what new states appear?
- Report *where* parsing stopped (like `strtol`'s end pointer).
