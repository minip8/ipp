**Approaches**
- Expected: long division. Handle the sign separately, work with absolute values in 64-bit, emit the integer part, then repeatedly multiply the remainder by 10 and divide. Record the output position at which each remainder first appeared (hash map); when a remainder repeats, insert `(` at its recorded position and append `)`. Stop when the remainder is 0. O(d) time and space where d is the number of distinct remainders (< |denominator|).

**Why it works (good discussion):** the digits produced from a given remainder are completely determined by it, so the first repeated remainder marks the start of the cycle — and since we detect the *first* repeat, the parentheses start as early as possible and the block is the shortest.

**Common wrong turns**
- Overflow: `abs(-2^31)` doesn't fit in 32 bits; `-2147483648 / -1` = 2147483648. Use 64-bit before taking absolute values.
- Sign errors: `-1 / 4` -> `"-0.25"` (integer part is 0, sign must still be printed); `0 / -5` -> `"0"`; both negative -> positive. Compute sign as XOR of the signs and only when the numerator is non-zero.
- Detecting repetition by repeated *digits* instead of repeated *remainders* (1/333 = 0.003003... has repeated 0 digits that aren't a cycle).
- Recording the remainder after emitting its digit, misplacing the `(`.

**Hint ladder**
1. Do the division by hand for 1/6 and 1/7. What do you keep track of between steps?
2. When does the sequence of digits start repeating — what state determines the next digit?
3. Store each remainder with the index where its digit is written; on seeing it again, you know where the cycle begins.

**Follow-ups**
- The maximum cycle length for a denominator d (at most d - 1; related to the multiplicative order of 10 mod d).
- Reverse problem: convert `"0.1(6)"` back to a reduced fraction.
- Output in base b instead of 10.
