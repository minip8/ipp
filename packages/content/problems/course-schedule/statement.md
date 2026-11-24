There are `numCourses` courses labelled `0` to `numCourses - 1`. Each entry `prerequisites[i] = [a, b]` means course `b` must be completed before course `a` can be taken.

You take one course at a time. Return `true` if it is possible to complete every course, and `false` otherwise.

**Examples**

```
numCourses = 3, prerequisites = [[1,0],[2,1]]          ->  true    (take 0, then 1, then 2)
numCourses = 2, prerequisites = [[1,0],[0,1]]          ->  false   (each needs the other first)
numCourses = 4, prerequisites = [[1,0],[2,1],[3,2],[1,3]]  ->  false   (1 -> 2 -> 3 -> 1 is a cycle)
```

**Constraints**

- `1 <= numCourses <= 10^5`
- `0 <= prerequisites.length <= 10^5`
- `prerequisites[i].length == 2`, `0 <= a, b < numCourses`
- Pairs may repeat. A pair `[a, a]` (a course requiring itself) makes the answer `false`.
