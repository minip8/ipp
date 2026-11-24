**Approaches**
- Simulation with a max-heap of remaining counts plus a cooldown queue: each time unit, run the most frequent available task. O(T log 26) where T is the answer — correct and a good "first working" solution.
- Expected: counting formula. Let `maxCount` be the highest frequency and `k` the number of labels with that frequency. The most frequent tasks form `maxCount - 1` full "frames" of length `n + 1` plus a final partial frame of length `k`: lower bound `(maxCount - 1) * (n + 1) + k`. If there are enough other tasks to fill all gaps, no idling is needed and the answer is `len(tasks)`. Answer = `max(len(tasks), (maxCount - 1) * (n + 1) + k)`. O(N) time, O(1) space (26 counters).

**Common wrong turns**
- Forgetting the `max(len(tasks), ...)` part — when tasks are plentiful the frame formula underestimates.
- Counting only one task with the max frequency (should add `k`, the number of labels tied for max).
- Greedy that runs tasks in label order rather than by remaining frequency (round-robin by letter wastes slots).
- n = 0.

**Hint ladder**
1. Which task constrains the schedule the most?
2. Lay out the most frequent task with exactly n gaps between occurrences. How long is that skeleton, and what goes in the gaps?
3. Compute the skeleton length (watch ties for the maximum frequency), then ask when the gaps can't all be filled versus when they overflow.

**Follow-ups**
- Return an actual schedule (heap-based simulation).
- Task Scheduler II: tasks must run in the given order (hash map of next allowed time).
- Different cooldown per task type, or tasks with different durations.
