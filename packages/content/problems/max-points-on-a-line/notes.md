**Approaches**
- Brute force: every pair defines a line; count points on it with a cross-product test. O(n^3) — ~10^9 at n = 1000.
- Expected: for each anchor point `p`, group every other point by the **direction** from `p`, using a hash map; the best line through `p` has `1 + max group size`. O(n^2) time, O(n) space per anchor.
- Representing direction exactly is the heart of the question: reduce `(dx, dy)` by `g = gcd(|dx|, |dy|)` and normalise the sign (e.g. make `dx > 0`, or `dx == 0 && dy > 0`). Vertical and horizontal lines then need no special case.

**Common wrong turns**
- Floating-point slopes `dy / dx`: precision collisions (e.g. directions (9999, 10000) vs (9998, 9999) differ by ~10^-8) and `-0.0` vs `0.0`, plus division by zero for vertical lines.
- Not normalising the sign: `(1, 2)` and `(-1, -2)` are the same direction.
- Using the slope alone as the global key without anchoring (parallel lines get merged).
- Forgetting that a single point gives answer 1.
- Optimisation: only consider points after the anchor (i < j) — fine and halves the work.

**Hint ladder**
1. Fix one point that is definitely on the best line. What do all other points on that line have in common, relative to it?
2. How can you represent a direction exactly, without floating point?
3. Reduce (dx, dy) by their gcd and fix the sign so equal directions have identical keys; count keys per anchor.

**Follow-ups**
- Points may repeat (duplicates count towards every line through that point).
- Real-valued coordinates — tolerance-based grouping and its pitfalls.
- Does any line contain at least k points? (Randomised: sample pairs.)
