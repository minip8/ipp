**Approaches**
- Brute force: simulate from every start. O(n^2) — too slow at 10^5.
- Expected: one pass greedy. If the total gas is less than the total cost, return -1. Otherwise scan with a running tank starting from candidate `start = 0`; whenever the tank goes negative after station `i`, no station in `[start, i]` can be a valid start, so set `start = i + 1` and reset the tank. O(n) time, O(1) space.
- Equivalent: the answer is the index just after the minimum prefix sum of `gas[i] - cost[i]`.

**Common wrong turns**
- Trying only stations where `gas[i] >= cost[i]` and simulating each (still O(n^2) worst case).
- Skipping the total-sum check and returning the last candidate even when the trip is impossible.
- Resetting `start` to `i` instead of `i + 1`.
- Believing the reset logic without justification — ask *why* every station between the old start and `i` can be skipped.

**Hint ladder**
1. When is the trip impossible from every station, no matter where you start?
2. If you start at `s` and first run dry right after station `i`, could any station between `s` and `i` work as a start?
3. Scan once with a running tank; when it goes negative, the next station becomes the new candidate. Combine with the total check.

**Follow-ups**
- Prove that a valid start exists whenever total gas >= total cost.
- If several starts could work, which does the greedy return? (The question here guarantees uniqueness.)
- Tank capacity is limited — how does the problem change?
