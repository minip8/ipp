**Approaches**
- Build a graph on the letters that appear. For each adjacent pair of words, find the first differing position and add the edge `a -> b` (a before b). If there is no differing position and the first word is longer, the input is invalid: return "".
- Topologically sort with Kahn's algorithm. Because the answer must be unique, the ready set is a **min-heap** (or, with only 26 letters, just scan for the smallest ready letter — O(26^2) total, perfectly fine). If fewer letters are output than appear, there is a cycle: return "".
- Total: O(C) to scan the words (C = total characters) plus O(26^2) for the sort. Space O(26^2 + C).
- DFS-based topological sort (reverse post-order) gives a valid order but not the required smallest one; it is a good discussion point but fails the hidden tests unless adapted.
- Comparing all pairs of words (not just adjacent) is O(N^2 * L) — unnecessary (adjacent pairs imply the rest by transitivity) and too slow on the large hidden tests.

**Common wrong turns**
- Adding constraints from *every* differing position instead of only the first one.
- Missing the prefix case (`"abc"` before `"ab"` is invalid) — or wrongly flagging `"ab"` before `"abc"` (valid).
- Forgetting letters that appear in words but in no constraint; they still belong in the answer (and are placed by the smallest-first rule).
- Adding duplicate edges and counting in-degree twice but decrementing once (use a set of edges or a 26x26 boolean matrix).
- Including all 26 letters instead of only the ones that appear.
- Self-edges can't arise from first-difference positions, but a cycle of length 2 (`a < b`, `b < a`) can; make sure it is detected.

**Hint ladder**
1. What does one adjacent pair of words tell you about the alphabet? What about a pair where one is a prefix of the other?
2. You now have "x comes before y" facts between letters. What kind of ordering problem is that?
3. Topological sort the letters; detect a cycle by counting how many letters you managed to output.
4. To make the result unique, whenever several letters are free, take the smallest — a min-heap (or a scan over 26 letters) for the ready set.

**Follow-ups**
- Is the alphabet uniquely determined by the dictionary? (Unique iff at every Kahn step exactly one letter is ready — equivalently there is a Hamiltonian path in the DAG.)
- Return all consistent alphabets.
- Explain the given sorted dictionary's information content: which pairs of letters remain unordered?
- Unicode alphabet with millions of symbols: heap becomes necessary.
