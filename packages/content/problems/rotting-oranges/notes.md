**Approaches**
- Brute-force simulation: each minute, scan the whole grid and rot neighbours of rotten oranges (using a copy or a "rotted this minute" mark). O((rows * cols)^2) worst case — a long snake of fresh oranges takes ~rows*cols/2 minutes, each costing a full scan. A hidden 200x200 snake test makes this too slow in Python.
- Expected: multi-source BFS. Put every initially rotten orange in the queue at time 0, BFS level by level, count fresh oranges and decrement as they rot. Answer = last level reached if fresh count hits 0, else -1. O(rows * cols) time and space.

**Common wrong turns**
- Running a separate BFS from each rotten orange and taking a max/min incorrectly — the sources must spread *simultaneously* (multi-source BFS).
- In simulation, rotting in place during the scan so an orange rotted this minute spreads again in the same minute.
- Returning -1 when there are no oranges at all, or no fresh ones (answer 0).
- Off-by-one: counting the final empty BFS level as a minute.
- Forgetting fresh oranges that are unreachable (must return -1).

**Hint ladder**
1. What does the set of rotten oranges look like after 1 minute, 2 minutes...? Which classic traversal grows in "rings" like that?
2. Every orange that is rotten at the start spreads at the same moment. How do you start a BFS from many cells at once?
3. Seed the queue with all rotten oranges, process the queue level by level, and track how many fresh oranges remain.
4. The answer is the number of levels that actually rotted something; if fresh oranges remain at the end, it is -1.

**Follow-ups**
- Return the minute at which each orange rots (distance grid).
- Some cells are "immune" for k minutes, or rot spreads diagonally too.
- Weighted spread times (Dijkstra).
- How would you parallelise this for a huge grid?
