**Approaches**
- Brute force: try every (buy, sell) pair with buy < sell. O(n^2) time, O(1) space. A fine opening statement.
- Expected: one pass, tracking the minimum price seen so far; at each day the best sale today is `price - minSoFar`. O(n) time, O(1) space.
- Equivalent framing: maximum subarray sum over the daily differences `prices[i] - prices[i-1]` (Kadane). Worth asking the candidate to see the connection.

**Common wrong turns**
- Taking global max minus global min, ignoring order (fails on `[9, 1]`-style inputs where the max comes first; e.g. `[2, 9, 1, 3]` gives 8 instead of 7).
- Returning a negative number when prices only fall; the answer is never below 0.
- Updating the minimum *before* computing the profit for the same day is fine here (profit 0), but candidates sometimes sell on the buy day in variants where that matters.
- Single-element input.

**Hint ladder**
1. If you knew you were going to sell on day j, which day would you buy on?
2. Do you need to look back over all earlier days each time, or can you carry something forward?
3. Keep one number from the past and one running best; update both in a single scan.

**Follow-ups**
- Unlimited transactions (sum of all positive day-to-day differences — why is that optimal?).
- At most two / at most k transactions (DP; state machine of holding/not holding).
- Transaction fee or a cooldown day after selling.
- Also return the buy and sell days; how do you break ties?
- Streaming prices: what is the memory footprint? (O(1) — this is why it's popular in trading interviews.)
