**Approaches**
- Hash map of counts: O(n) time, O(n) space. Fine first answer.
- Sort and return the middle element: O(n log n), O(1) extra if sorting in place. Ask *why* the middle must be the majority.
- Expected follow-through: Boyer-Moore voting. Keep a candidate and a counter; equal value increments, different value decrements, at zero adopt the current value. O(n) time, O(1) space. Ask the candidate to justify it (pairing off distinct values can never eliminate all copies of the majority).
- Also valid: per-bit majority (for each of 32 bits, take the majority bit) — O(32n), O(1); careful with negatives.
- Randomised: pick a random element and verify; expected O(n).

**Common wrong turns**
- Boyer-Moore without the guarantee: the candidate is only *possibly* the majority; a second verification pass is needed if existence isn't promised. Ask what changes.
- Bitwise approach with sign handling in Python (unbounded ints).
- Returning the mode when the problem guarantee is dropped ("most frequent" is not "majority").

**Hint ladder**
1. If you cancel one occurrence of the majority against one occurrence of some other value, does it stay the majority of what's left?
2. Could a single "current guess" plus a counter be enough state?
3. Increment on agreement, decrement on disagreement, and replace the guess when the counter hits zero.

**Follow-ups**
- No guarantee that a majority exists: add a verification pass.
- All elements appearing more than n/3 times (at most two; Boyer-Moore with two candidates).
- Streaming / distributed data: how would you combine partial results from several machines? (Boyer-Moore states can be merged.)
