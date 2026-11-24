**Approaches**
- Sort, then scan counting runs (skip duplicates, reset on gaps). O(n log n) — a solid first answer; ask for O(n).
- Expected: put all values in a hash set; for each value `v` that is the **start** of a run (`v - 1` not in the set), walk `v+1, v+2, ...` while present. Each value is visited O(1) times in total, so O(n) expected time, O(n) space.
- Union-find over adjacent values also works (near-linear) but is heavier than needed.

**Common wrong turns**
- Walking forward from *every* value instead of only run starts: O(n^2) on a single long run like `0..n-1` (a hidden test is exactly that, shuffled).
- Iterating over the original array (with duplicates) rather than the set: with many copies of a run start, the walk repeats. Iterate the set.
- Counting duplicates as part of the run (`[1, 2, 2, 3]` is 3, not 4).
- Empty input.
- `v + 1` overflow at `INT_MAX` in C++ (values here stay within 10^9, but worth a mention).

**Hint ladder**
1. With values in a hash set, how cheaply can you check whether `v + 1` exists?
2. If you start counting from every value you'll redo a lot of work. Which values are worth starting from?
3. Only start from values with no predecessor in the set, and iterate over the set rather than the array.

**Follow-ups**
- Return the run itself, not just its length.
- Streaming inserts with "current longest run" queries (union-find / interval map).
- Why is the hash approach "expected" O(n)? What about adversarial hashing (e.g. `unordered_set` with crafted keys)?
