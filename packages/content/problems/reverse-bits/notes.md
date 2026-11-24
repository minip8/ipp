**Approaches**
- Loop 32 times: `result = (result << 1) | (n & 1); n >>= 1`. O(32) time, O(1) space. This is the expected baseline.
- Divide and conquer with masks: swap 16-bit halves, then 8-bit groups (`0xff00ff00`/`0x00ff00ff`), then nibbles, pairs, single bits — 5 steps, branch-free. Great follow-up for a low-latency interview.
- Byte lookup table: reverse each of the 4 bytes via a 256-entry table and reassemble — a time/memory trade-off when called millions of times.

**Common wrong turns**
- Stopping when `n` becomes 0 (leading zeros of the input are trailing zeros of the output — the result must still be shifted 32 times in total). `n = 1` catches this.
- Signed 32-bit types in C++/Java: `1 << 31` on `int` is negative/UB; use `uint32_t` (or the 64-bit type here) and mask with `0xFFFFFFFF`.
- In Python, not masking after shifting left (unbounded ints).

**Hint ladder**
1. How would you read the lowest bit of `n`, and how would you append a bit to the low end of a result?
2. If you peel bits off `n` from the bottom and push them onto the result from the bottom, what order do they end up in?
3. Do exactly 32 iterations regardless of when `n` becomes zero.

**Follow-ups**
- The function is called on a hot path billions of times: table lookup vs mask-swap; what about the hardware instruction (`rbit` on ARM)?
- Reverse bits of a 64-bit value.
- Check whether a number's binary form is a palindrome.
