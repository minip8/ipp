A CPU must run a list of tasks, each labelled with an uppercase letter. Every task takes exactly one time unit. In each unit the CPU either runs one task or sits idle.

Tasks with the **same label** must be separated by at least `n` units: if a task `X` runs at time `t`, the next `X` may run no earlier than time `t + n + 1`. Tasks may be run in any order.

Return the **minimum number of time units** needed to run all the tasks.

**Examples**

```
tasks = [A, A, A, B, B, B], n = 2   ->   8     A B _ A B _ A B
tasks = [A, C, A, B, D, B], n = 1   ->   6     A B A B C D (no idling)
tasks = [A, A, A, B, B, B], n = 0   ->   6
tasks = [A, A, A, A, B, C], n = 3   ->   13    A B C _ A _ _ _ A _ _ _ A
```

**Constraints**

- `1 <= tasks.length <= 10^4`
- `tasks[i]` is an uppercase English letter.
- `0 <= n <= 100`
