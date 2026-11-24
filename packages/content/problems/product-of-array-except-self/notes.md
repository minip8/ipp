**Approaches**
- Brute force: for each i multiply all others. O(n^2).
- With division: total product / nums[i] — forbidden, and also breaks with zeros (count zeros: 0, 1, or 2+ zeros are three different cases). Worth discussing why the constraint exists.
- Expected: prefix and suffix products. `answer[i] = (product of nums[0..i-1]) * (product of nums[i+1..n-1])`. Two arrays: O(n) time and space.
- Optimal space: write prefix products into the output array, then sweep from the right with a running suffix product. O(n) time, O(1) extra.

**Common wrong turns**
- Using division and then special-casing zeros incorrectly (`[0, 4, 0]` must be all zeros; `[3, 0, 2]` has one non-zero entry).
- Off-by-one: including `nums[i]` in its own prefix or suffix.
- Overflow: the guarantee bounds prefix/suffix products; ask what changes if it didn't (64-bit, or modular arithmetic).

**Hint ladder**
1. Split "everything except i" into two parts relative to i.
2. Could you precompute the product of everything to the left of each index in one pass? And to the right?
3. Combine the two; then try to reuse the output array so the second pass needs only a single running variable.

**Follow-ups**
- Same with division allowed: handle zeros correctly.
- Answer queries "product of range [l, r] except index i" — prefix products, or a segment tree when there are zeros/updates.
- Results modulo a prime (division becomes modular inverse — but zero still breaks it).
