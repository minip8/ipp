**Approaches**
- Sort task indices by enqueue time. Simulate with a clock and a min-heap of available tasks keyed by (processingTime, index):
  - push every task whose enqueue time <= clock;
  - if the heap is empty, jump the clock to the next enqueue time (don't tick one unit at a time);
  - otherwise pop, record the index, and advance the clock by its processing time.
  O(n log n) time, O(n) space.
- Brute force: at each step scan all remaining tasks for the best available one — O(n^2).

**Common wrong turns**
- Advancing the clock one unit at a time while idle (times go up to 10^9).
- Overflow: the clock can reach about 10^5 * 10^9 = 10^14; use 64-bit in C++/Java.
- Tie-breaking on enqueue time instead of index, or forgetting the index tie-break altogether.
- Sorting the tasks themselves and losing original indices.
- Strict vs non-strict availability: a task that arrives exactly when the previous finishes must be considered.
- When idle, jumping the clock but only pushing one task, missing others that arrive at the same instant.

**Hint ladder**
1. At any decision point, which tasks are candidates, and how do you pick among them?
2. Process arrivals in time order so you can add newly available tasks incrementally. What ordering of the input helps?
3. Keep the available tasks in a min-heap keyed by (processing time, index).
4. Loop: move all arrived tasks into the heap; if the heap is empty jump the clock to the next arrival; else run the top task and advance the clock.

**Follow-ups**
- Multiple CPUs (process tasks on m servers; LeetCode 1882).
- Preemptive scheduling (shortest remaining time first).
- Report the average waiting time, or the time each task finished.
