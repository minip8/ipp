**Approaches**
- Linear scan `r = 0, 1, 2, ...` while `(r+1)^2 <= x`: O(sqrt x) — up to ~9.5 * 10^7 iterations here, too slow in Python; good to reject on paper.
- Expected: binary search on the answer in `[0, x]` (or `[0, min(x, 2^27)]`), keeping the largest `mid` with `mid * mid <= x`. O(log x) time, O(1) space.
- Newton's method on integers: `r = (r + x / r) / 2` starting from `x` (or a power of two above sqrt x), stop when it stops decreasing. Quadratic convergence; the termination condition is the interesting bit.
- `int(sqrt(x))` with doubles is wrong near perfect squares for large 64-bit values (that's why it's disallowed); the candidate should know why.

**Common wrong turns**
- Overflow of `mid * mid` in C++/Java when the upper bound is `x` and `x` is near 2^63 (here x < 2^53 so `mid <= 2^53` and `mid*mid` *does* overflow 64 bits). Compare `mid <= x / mid` instead, or cap the upper bound at `2^27`.
- Off-by-one in the binary search loop (infinite loop with `lo = mid`, or returning `lo` when the invariant holds for `hi`).
- Returning a rounded result instead of the floor (`27 -> 5`, not 5.196 rounded to 5 — fine — but `35 -> 5`, not 6).

**Hint ladder**
1. The predicate `r * r <= x` is true for small r and false for large r. What does that suggest?
2. What are safe lower and upper bounds for the answer?
3. Binary search for the last r where the predicate holds — and make sure computing `r * r` can't overflow.

**Follow-ups**
- Newton's method: why does it converge, and how many iterations for 64-bit inputs?
- Square root of a double to a given precision.
- Perfect-square check, or the integer k-th root.
