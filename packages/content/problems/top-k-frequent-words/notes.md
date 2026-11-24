**Approaches**
- Count with a hash map, then sort the distinct words by (-count, word) and take k: O(n + m log m) for m distinct words. A perfectly good first answer.
- Heap of size k: keep the k "best" words under the ordering (higher count, then smaller word). The heap's root must be the *worst* of the kept words, so its comparator is reversed: lower count first, and for equal counts the alphabetically **larger** word first. Pop into a list and reverse. O(n + m log k).
- Python: `heapq.nsmallest(k, counts, key=lambda w: (-counts[w], w))` is O(m log k) and correct; ask them to explain what it does internally.
- Bucket sort by frequency (buckets 1..n), each bucket sorted alphabetically: O(n + m log m) worst case but fast in practice.

**Common wrong turns**
- Tie-break direction inside the size-k heap: with a min-heap on count, ties must evict the alphabetically *larger* word. Getting this backwards is the classic bug (the `"b","a","c"` sample catches it).
- Returning in heap pop order (worst first) without reversing.
- Sorting only by count and relying on a stable sort of insertion order for ties.
- In Java, comparing boxed `Integer` counts with `==`/`!=` (fails above 127).

**Hint ladder**
1. First, how do you get every word's frequency in one pass?
2. With counts in hand, what ordering do you need? Write it as a comparison key.
3. Sorting all distinct words works; can you avoid sorting all of them when k is small?
4. A heap of size k whose root is the weakest kept word (lowest count; among equal counts the alphabetically largest). Push each word, pop when size exceeds k, then reverse the pops.

**Follow-ups**
- Words arrive as an endless stream; report the top k at any time (heap + map with lazy updates, or count-min sketch for approximate counts).
- Too many distinct words to fit in memory on one machine.
- Return top k by frequency where ties keep first-appearance order instead.
