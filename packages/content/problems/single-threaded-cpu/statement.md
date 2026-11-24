A CPU runs one task at a time. You are given `n` tasks, where `tasks[i] = [enqueueTime, processingTime]`: task `i` becomes available at time `enqueueTime` and needs `processingTime` units of uninterrupted CPU time.

The CPU follows these rules:

- If it is idle and no task is available, it waits until the next task becomes available.
- If it is idle and at least one task is available, it starts the available task with the **shortest processing time**; ties are broken by the **smallest index**.
- Once started, a task runs to completion. The CPU can start the next task at the exact moment the previous one finishes, and a task whose `enqueueTime` equals that moment counts as available.

Return the indices of the tasks in the order the CPU runs them.

**Examples**

```
tasks = [[1, 3], [2, 1], [3, 2], [4, 1]]   ->   [0, 1, 3, 2]
```
At time 1 only task 0 is available; it runs until 4. At time 4 tasks 1, 2 and 3 are available; tasks 1 and 3 both need 1 unit, so the smaller index 1 goes first (until 5), then 3 (until 6), then 2.

```
tasks = [[5, 2], [5, 2], [5, 1], [20, 3]]   ->   [2, 0, 1, 3]
```
The CPU finishes tasks 2, 0 and 1 by time 10 and then sits idle until task 3 arrives at 20.

**Constraints**

- `1 <= n <= 10^5`
- `1 <= enqueueTime, processingTime <= 10^9`
