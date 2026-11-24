This is the array form of "merge k sorted linked lists"; the reasoning is identical.

**Approaches**
- Min-heap of (value, which array, index): seed with the head of each non-empty array; repeatedly pop the smallest, append it, push the next element of the same array. O(N log k) time, O(k) extra space.
- Divide and conquer: merge arrays in pairs (1+2, 3+4, ...), then pairs of results, like the merge phase of merge sort. log k rounds of O(N) each: O(N log k). No heap needed.
- Sequential merge (result = merge(result, arrays[i]) for each i): O(N · k) in the worst case — each element is copied up to k times. The trap to avoid.
- Concatenate and sort: O(N log N). Correct and often fast in practice; acceptable as a baseline but it ignores the sortedness — ask why it is asymptotically worse than N log k.

**Common wrong turns**
- Pushing empty arrays' "first element" into the heap (index out of bounds).
- In Python, heap tuples (value, array) compare arrays on ties — include the array index so ties never compare lists, and push indices rather than slicing.
- C++: `priority_queue` is a max-heap; forgetting `greater<>` returns descending output.
- Returning early when one array runs out.

**Hint ladder**
1. With two sorted arrays you know how to merge in linear time. What goes wrong if you just repeat that k times?
2. At any moment, the next output element is the smallest among the k current "front" elements. How do you find the minimum of k candidates repeatedly and cheaply?
3. A min-heap holding one front element per array: pop the minimum, then push its successor from the same array.
4. Alternatively, pair arrays up and merge like merge sort so each element is copied only log k times.

**Follow-ups**
- The arrays are huge files on disk (external merge sort; buffered reads; k-way merge with a heap).
- Remove duplicates while merging.
- Find the k-th smallest element across the arrays without merging everything.
- In C++, how would you avoid copying when the inputs are `std::list`s (splice)?
