A staircase has `n` steps. From any position you may climb either **1 step** or **2 steps** at a time. You start at the bottom (step 0) and want to stand exactly on step `n`.

Return the number of different sequences of moves that take you from step 0 to step `n`. Two sequences are different if they differ in at least one position (so `1 then 2` and `2 then 1` count separately).

**Examples**

```
n = 2   ->  2     (1+1, 2)
n = 4   ->  5     (1+1+1+1, 1+1+2, 1+2+1, 2+1+1, 2+2)
n = 1   ->  1
```

**Constraints**

- `1 <= n <= 45` (the answer fits in a signed 32-bit integer)
