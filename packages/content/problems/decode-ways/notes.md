**Approaches**
- Brute force: recursion that takes one digit or two digits at each step. Correct but exponential: `"111...1"` with 45 ones has ~1.8*10^9 decodings and the recursion visits each.
- Expected: `ways[i]` = decodings of the first i characters. `ways[0] = 1`; add `ways[i-1]` if `s[i-1] != '0'`; add `ways[i-2]` if the two-digit number `s[i-2..i-1]` is between 10 and 26. O(n) time, O(1) space with two rolling variables.

**Common wrong turns**
- Zero handling, the heart of the problem: a `0` can only appear as the second digit of `10` or `20`. `"0"`, `"30"`, `"100"`, `"1001"` all give 0; `"2101"` gives 1.
- Accepting `"05"`-style two-digit codes (checking `<= 26` but forgetting `>= 10`).
- Returning 1 for an input that starts with `'0'`.
- Treating `27`-`29` as valid pairs.
- Combinatorial shortcuts (Fibonacci on runs of 1s/2s) without handling the boundaries correctly; possible, but fiddly.

**Hint ladder**
1. Look at how the last letter of a decoding can be formed: from the last one digit, or the last two digits. When is each allowed?
2. If you knew the number of decodings of every shorter prefix, how would you combine them?
3. Define `ways[i]` for prefixes, with `ways[0] = 1`, and add the contributions of a valid one-digit and a valid two-digit ending.
4. Only the previous two values are needed. Double-check "0", "10", "100" and "27".

**Follow-ups**
- Return the answer mod 10^9+7 for strings of length 10^5.
- Add a wildcard `*` that stands for any digit 1-9 (decode-ways-ii).
- List all decodings (backtracking; output may be exponential).
- Why is `ways[0] = 1` the right base case?
