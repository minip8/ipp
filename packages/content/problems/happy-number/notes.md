**Approaches**
- Simulate with a hash set of seen values; stop at 1 (happy) or a repeat (cycle). O(k) where k is the number of steps — small, because after one step any 32-bit input becomes at most 9^2 * 10 = 810.
- Expected discussion: Floyd's cycle detection (slow moves one step, fast two) gives O(1) extra space. The sequence is a functional graph, so it must end in a cycle; the question is whether the cycle is `{1}`.
- Hard-code the known unhappy cycle (`4 -> 16 -> ... -> 4`): correct but needs justification.

**Common wrong turns**
- No cycle detection — infinite loop.
- Arguing the sequence could grow without bound: ask the candidate to bound it (a d-digit number maps to at most 81d, which is smaller than the number once d >= 4).
- Digit extraction bugs with `n % 10` / `n / 10` on large inputs (none in practice, but string conversion is slower).

**Hint ladder**
1. What are the only two things that can happen to the sequence?
2. Can the values grow forever? Bound the next value for a number with d digits.
3. Detect a repeat — with a set, or without extra memory using two pointers moving at different speeds.

**Follow-ups**
- Prove termination of the loop / bound the number of steps.
- O(1) space (Floyd), and how Floyd's algorithm also finds the cycle start.
- Count happy numbers up to N (memoise on the first-step value, which is at most 810 for 32-bit inputs).
