**Approaches**
- Plain recursion `f(n) = f(n-1) + f(n-2)`: correct but exponential (~1.6^n calls); n = 45 takes billions of calls. A good warm-up to ask "why is this slow?".
- Memoised recursion or bottom-up table: O(n) time, O(n) space.
- Expected final answer: keep only the last two values, O(n) time, O(1) space. Candidates should notice this is the Fibonacci sequence shifted by one (f(1)=1, f(2)=2).
- Bonus: matrix exponentiation gives O(log n); Binet's formula works for small n but floating-point error bites for large n.

**Common wrong turns**
- Off-by-one base cases (f(0) = 1, f(1) = 1, f(2) = 2). Ask them to verify n = 1 and n = 2 by hand.
- Returning f(n-1) or f(n+1) because the recurrence was indexed differently.
- Counting combinations instead of ordered sequences (that would give 3 for n = 4).

**Hint ladder**
1. Think about the very last move you make to land on step n. What could it be?
2. If the last move was a single step, where were you before it? And for a double step?
3. So the count for n is built from the counts for n-1 and n-2. Why is direct recursion slow, and what can you reuse?
4. You only ever need the previous two values; iterate upward from the base cases.

**Follow-ups**
- Allowed step sizes are an arbitrary set `{s1, ..., sk}`: `f(n) = sum f(n - si)`, O(n*k). How is that related to coin change (order matters here, not there)?
- Some steps are broken and cannot be stepped on.
- n up to 10^18 with the answer modulo 10^9+7: 2x2 matrix exponentiation, O(log n).
- What happens with 32-bit ints at n = 46? (overflow; use long long)
