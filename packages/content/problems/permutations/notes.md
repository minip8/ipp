**Approaches**
- Backtracking with a `used` array: build the permutation position by position, trying every unused element. O(n · n!) time, O(n) extra space besides the output.
- In-place swapping: for position i, swap each j ≥ i into position i, recurse on i + 1, swap back. Same complexity, no `used` array.
- Next-permutation: sort, then repeatedly apply the next-lexicographic-permutation step (`std::next_permutation`). Good to know; ask them to explain the step if they reach for the library.
- Insertion: permutations of n elements = every permutation of n − 1 elements with the nth inserted in each of n gaps.

**Common wrong turns**
- Appending a reference to the working list rather than a copy (Python).
- Forgetting to undo the choice (`used[i] = false` / swap back) when returning.
- Using `unordered_deep`-style thinking: [1,2,3] and [3,2,1] are different answers; a set of sorted tuples is the wrong dedupe.
- Checking "is x already in current" with a linear scan — correct but O(n) per step; fine for n ≤ 7 but worth noting.

**Hint ladder**
1. How many choices for the first position? For the second, once the first is fixed?
2. Recursion: fix one position at a time; what do you need to remember about which elements are taken?
3. Keep a boolean per element (or swap the chosen element into place); record a copy when all positions are filled.
4. Remember to undo each choice before trying the next one.

**Follow-ups**
- Input has duplicates: output each distinct permutation once (sort, skip an element equal to its previous sibling when that sibling is unused).
- Produce the k-th permutation directly without generating the others (factorial number system).
- Implement next_permutation from scratch, and argue its amortised cost.
- Why can n not be much larger here? (10! ≈ 3.6M permutations of length 10.)
