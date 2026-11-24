**Approaches**
- Plain Kahn's algorithm with a FIFO queue, or reverse DFS post-order, gives *a* valid topological order, but not the one this problem asks for. That is the most common miss: ask the candidate to trace example 2 (FIFO Kahn gives [2,3,0,1] there by luck; example 1 also matches, but hidden tests do not).
- Expected: Kahn's algorithm where the "ready" set is a min-heap (priority queue) keyed by label. Pop the smallest ready course, append it, decrement in-degrees of its dependants, push those that reach 0. If fewer than `numCourses` courses were taken, there is a cycle: return []. O((V + E) log V) time, O(V + E) space.
- Why greedy is correct: the first element of any valid order must be a source; choosing the smallest available source can never block a later choice, because removing a source only makes more vertices available (exchange argument). Good candidates can sketch this.
- DFS cannot easily produce the lexicographically smallest order (reverse post-order of DFS in increasing label order is *not* it). Some candidates try "DFS from smallest unvisited vertex": wrong on e.g. 3 courses, [[0,2]] -> expected [1,2,0]; reverse post-order of a DFS started from 0, 1, 2 in turn gives [2,1,0].
- Scanning all vertices each step for the smallest available one: O(V^2), too slow at 10^5 (hidden tests are sized to separate this in Python).

**Common wrong turns**
- Edge direction: `[a, b]` means b -> a. Getting it backwards produces a valid-looking but wrong order.
- Returning a partial order instead of [] on a cycle.
- Duplicated prerequisite pairs: in-degree counted twice must also be decremented twice (store duplicates in the adjacency list, or dedupe both).
- Sorting the final Kahn output: not a valid topological order in general.

**Hint ladder**
1. Which courses can possibly come first? Which of them does the rule pick?
2. After taking a course, which courses might become available? How do you know cheaply when one does?
3. Keep in-degrees, and keep the currently available courses in a structure that always yields the smallest label quickly.
4. A min-heap of ready courses, Kahn-style; detect a cycle when the heap empties before all courses are taken.

**Follow-ups**
- Prove the greedy choice is optimal.
- Largest-label-first, or lexicographically smallest *reversed* order (different problem: "smallest label as early as possible" needs reverse graph + max-heap).
- Courses have durations and unlimited parallelism: earliest finish time (longest path).
- If prerequisites arrive as a stream, can you maintain the order incrementally?
