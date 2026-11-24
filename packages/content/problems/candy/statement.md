Children stand in a line; child `i` has rating `ratings[i]`. Hand out candies so that:

- every child gets **at least one** candy, and
- a child with a **strictly higher** rating than an adjacent neighbour gets **strictly more** candies than that neighbour.

Children with equal ratings next to each other have no constraint between them. Return the **minimum** total number of candies.

**Examples**

```
ratings = [1, 0, 2]        ->   5      2, 1, 2
ratings = [1, 2, 2]        ->   4      1, 2, 1 (the second 2 can get just one)
ratings = [1, 3, 4, 5, 2]  ->   11     1, 2, 3, 4, 1
```

**Constraints**

- `1 <= ratings.length <= 2 * 10^4`
- `0 <= ratings[i] <= 2 * 10^4`
