**Approaches**
- Expected (iterative): two stacks (or one stack of pairs) holding the string built so far and the pending repeat count at each `[`. On `]`, pop, repeat the current segment, and append it to the outer one. O(output) time and space.
- Recursive descent: `parse(i)` reads letters and `k[...]` groups until `]` or the end, returning the string and next index. Same complexity; clean and easy to reason about.
- Repeatedly replacing the innermost `k[...]` via regex works but is O(output * nesting) — mention as a contrast.

**Common wrong turns**
- Reading only single-digit counts (`10[a]`, `300[...]`).
- Building the result with repeated `s = s + x` in a loop in a language where that's quadratic, or repeating the *whole* string so far instead of just the bracket body.
- Losing the prefix text before a nested bracket (`x3[y2[z]]`).
- Empty bodies (`2[]`).

**Hint ladder**
1. When you hit `]`, what two pieces of information do you need to finish that group?
2. Groups nest — what structure remembers the "outer" context while you work on an inner group?
3. On `[` save (text so far, count) and start fresh; on `]` repeat the fresh text and attach it to the saved text.

**Follow-ups**
- The decoded string is too large to materialise: return the character at position K (work with lengths, walk backwards).
- Write the encoder: shortest encoding of a string (interval DP — much harder).
- Malformed input handling: unmatched brackets, leading zeros, missing counts.
