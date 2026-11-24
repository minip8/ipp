**Approaches**
- Brute force: every pair, O(n^2). Fine to state; too slow at 10^5.
- Expected: two pointers at both ends. Compute the area, then move the pointer at the **shorter** wall inward. O(n) time, O(1) space.
- Why it's correct (the part worth probing): with `height[l] <= height[r]`, every container using wall `l` with some `r' < r` has a smaller width and a water level of at most `height[l]`, so none beats the current one — wall `l` can be discarded safely.

**Common wrong turns**
- Moving the taller wall, or moving both.
- Thinking it's "Trapping Rain Water" (summing over cells) — different problem.
- Sorting by height (loses positions).
- On equal heights either pointer can move; candidates sometimes believe this needs special handling — ask them to argue why it doesn't.

**Hint ladder**
1. Start with the widest possible container. What limits its capacity?
2. If you shrink the width, the only way to gain is a taller limiting wall. Which wall should you give up on?
3. Two pointers from both ends; always discard the shorter wall — and convince yourself nothing is lost.

**Follow-ups**
- Prove the two-pointer greedy correct (exchange argument above).
- Return the pair of indices; what about ties?
- Trapping Rain Water (sum of water above each bar) — how is it different?
