**Approaches**
- Backtracking: at index i decide "take nums[i]" or "skip it"; record the current subset at the leaves (or record at every node of the "choose the next index ≥ i" tree). O(n · 2^n) time (each subset copied once), O(n) extra stack.
- Iterative doubling: start with [[]]; for each x append a copy of every existing subset with x added. Same complexity, no recursion.
- Bitmask: for mask in 0 .. 2^n − 1, include nums[i] when bit i is set. Same complexity; a natural lead-in to bit tricks.

**Common wrong turns**
- Appending the shared `current` list instead of a copy (Python: `res.append(cur)` then mutating `cur`; ends up with many references to one empty list). In C++ `res.push_back(cur)` copies, so the bug does not appear there — ask why.
- Forgetting the empty subset.
- Iterative version: iterating over `res` while appending to it (infinite loop in Python, invalidated iterators in C++). Take the size first.
- Using `1 << n` with n large in another context — fine here, but ask what happens at n = 31/32 for int.

**Hint ladder**
1. How many subsets are there, and what single decision does each element contribute?
2. Can you build all subsets of the first k elements from those of the first k − 1?
3. Recursion: for each element, branch on include/exclude; when you have decided every element, record a copy.
4. Alternatively, each integer from 0 to 2^n − 1 is a subset if you read its bits.

**Follow-ups**
- Input may contain duplicates; return each distinct subset once (sort, then skip equal siblings at the same depth).
- Return only subsets of size k (combinations) and prune early.
- Generate the subsets in Gray-code order so consecutive subsets differ by one element.
- Memory: the output itself is O(n · 2^n); could you stream subsets instead (generator / callback)?
