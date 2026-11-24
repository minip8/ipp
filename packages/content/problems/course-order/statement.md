There are `numCourses` courses labelled `0` to `numCourses - 1`. Each entry `prerequisites[i] = [a, b]` means course `b` must be completed before course `a`.

Produce a plan that takes every course exactly once, one at a time, respecting all prerequisites. Many plans may be valid, so build it with this rule: **at every step, take the course with the smallest label among those whose prerequisites are all already completed.** (Equivalently: return the lexicographically smallest valid order.)

Return the plan as a list of course labels. If no valid plan exists, return an empty list.

**Examples**

```
numCourses = 4, prerequisites = [[1,0],[2,0],[3,1],[3,2]]   ->  [0,1,2,3]
```

At the start only 0 is available. After it, both 1 and 2 are available; take 1 (smaller), then 2, then 3.

```
numCourses = 4, prerequisites = [[0,3],[1,3]]               ->  [2,3,0,1]
```

Courses 2 and 3 are available at the start; 2 is smaller. After 3, courses 0 and 1 open up.

```
numCourses = 2, prerequisites = [[0,1],[1,0]]               ->  []
```

**Constraints**

- `1 <= numCourses <= 10^5`
- `0 <= prerequisites.length <= 10^5`
- `0 <= a, b < numCourses`; pairs may repeat; `[a, a]` makes the plan impossible.
