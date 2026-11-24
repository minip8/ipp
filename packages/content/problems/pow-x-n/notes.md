**Approaches**
- Naive: multiply n times. O(n) — up to 2 * 10^9 multiplications.
- Expected: exponentiation by squaring. Recursive: `x^n = (x^(n/2))^2` times an extra `x` if n is odd. Iterative: walk the bits of `|n|`, squaring a base and multiplying it into the result when the bit is set. Negative n: compute with `1/x` (or invert at the end). O(log |n|) multiplications, O(1) space iteratively.

**Common wrong turns**
- `n = -2^31`: negating it overflows a 32-bit int in C++/Java. Convert to 64-bit first.
- Recursing as `pow(x, n/2) * pow(x, n/2)` (two calls — back to O(n)).
- Negative n with integer division rounding toward zero in the recursion (`-3 / 2 == -1`): handle the sign up front.
- Returning integers or losing precision by converting to float too late (Python).

**Hint ladder**
1. If you know `x^k`, how cheaply can you get `x^(2k)`?
2. How does the binary representation of n tell you which squares to multiply together?
3. Square the base repeatedly and multiply it into the result for each 1 bit of |n|; deal with the sign separately — careful with the most negative int.

**Follow-ups**
- Modular exponentiation `(a^b) mod m` (and why it's the core of RSA / Fermat tests).
- Matrix exponentiation for Fibonacci in O(log n).
- Accuracy: how does error accumulate with repeated squaring vs naive multiplication?
