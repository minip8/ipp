**Approaches**
- Repeated addition / schoolbook with string additions per digit of `num2`: O(n * m) digit operations but with heavy string building.
- Expected: one integer array `res` of length `n + m`. The digit product `num1[i] * num2[j]` contributes to positions `i + j` (carry) and `i + j + 1` (units). Accumulate all products, then propagate carries once from the right (or carry as you go). Strip leading zeros. O(n * m) time, O(n + m) space.
- Karatsuba (O(n^1.585)) / FFT-based multiplication — great follow-up discussion, not expected to code.

**Common wrong turns**
- Converting to int/long (overflows at ~19 digits in C++/Java; "works" in Python but defeats the purpose).
- Index bookkeeping: product of digits at `i` and `j` (from the left) lands at `i + j + 1`.
- Leading zeros in the result, and `"0"` times anything.
- Accumulating without carrying in a small integer type: each cell can receive up to ~1000 * 81 before carrying — fits in 32 bits, but worth checking.

**Hint ladder**
1. How long can the product of an n-digit and an m-digit number be?
2. When you multiply digit `i` of `num1` by digit `j` of `num2`, which position(s) of the result does it affect?
3. Accumulate every digit product into an array of n + m slots, then resolve carries and strip leading zeros.

**Follow-ups**
- Karatsuba: how does splitting into halves save a multiplication?
- Multiply very large numbers stored in base 10^9 chunks (fewer operations).
- Divide two big numbers, or compute a factorial as a string.
