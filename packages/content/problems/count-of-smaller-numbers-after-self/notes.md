**Approaches**
- Brute force: for each i scan to the right. O(n^2) — ~5 * 10^9 at n = 10^5.
- Insert into a sorted list from the right, using binary search for the count: O(n log n) comparisons but O(n) per insertion into an array (O(n^2) moves) — acceptable-ish in practice, worth discussing why it's not truly n log n. A balanced BST with subtree sizes fixes it.
- Expected (A): Fenwick tree / BIT over values (shifted by 10^4, or coordinate-compressed). Scan from the right: answer = prefix count of values `< nums[i]`, then add `nums[i]`. O(n log V) time, O(V) space.
- Expected (B): merge sort on indices. While merging, when an element from the left half is placed, every element already taken from the right half is smaller and was to its right — add that count. O(n log n) time, O(n) space.

**Common wrong turns**
- Counting `<=` instead of `<` (equal values).
- Merge sort that counts inversions overall but doesn't attribute them to original indices (must sort indices, not values).
- BIT indexed from 0 (infinite loop on `i += i & -i`), or negative values not shifted.
- Sorting the values and using `bisect` on the original array (ignores "to the right").

**Hint ladder**
1. Process the array from right to left. What do you need to know about the elements you've already seen?
2. You need "how many seen values are smaller than x" with insertions in between. Which data structures answer prefix counts with updates in O(log n)?
3. Either a Fenwick tree over the value range, or merge sort on indices where the count is accumulated when a left-half element is placed after some right-half elements.

**Follow-ups**
- Count all inversions; count "reverse pairs" with `nums[i] > 2 * nums[j]`.
- Values up to 10^9: coordinate compression.
- Online version (elements arrive left to right, queries ask about the future?) — what changes?
