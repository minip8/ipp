**Approaches**
- Expected: walk both strings from the right with a carry, appending `(x + y + carry) % 2` and carrying `(x + y + carry) / 2`; reverse at the end. O(max(n, m)) time and space.
- Converting to an integer (`int(a, 2)` in Python, `stoull` in C++) — Python's big ints make it pass, but ask what it costs and why it fails in C++/Java (64-bit overflow). Steer the candidate to the digit-wise algorithm.
- Bitwise "add without +" on big integers (XOR for sum, AND<<1 for carry) — interesting follow-up, not expected.

**Common wrong turns**
- Forgetting the final carry (`"1" + "1"` must be `"10"`).
- Prepending characters in a loop (`res = ch + res`) — quadratic in many languages; append then reverse.
- Mishandling different lengths (index past the start of the shorter string).
- Returning leading zeros.

**Hint ladder**
1. How did you add multi-digit numbers on paper?
2. What do you need to remember between one column and the next?
3. Two indices from the right, a carry, and keep going while either index is valid or the carry is non-zero.

**Follow-ups**
- Same for an arbitrary base, or for decimal strings (Add Strings).
- Multiply two binary/decimal strings.
- Add numbers stored as reversed digit arrays or linked lists.
