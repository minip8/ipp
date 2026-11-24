Write an iterator that walks through a list of lists of integers as if it were one flat list, row by row, left to right.

- `Vector2D(vec)` creates the iterator positioned before the first element. Rows of `vec` may be **empty**, and `vec` itself may have no rows.
- `next()` returns the next element and advances past it.
- `hasNext()` returns `true` if at least one element remains, `false` otherwise. It does not advance.

`next()` is only called when there is a next element (that is, `hasNext()` would return `true`). `hasNext()` may be called any number of times, including several times in a row.

Do **not** copy all the elements into a new flat array in the constructor: the iterator should use O(1) extra memory and keep only positions into `vec`.

**Example**

```
Vector2D it([[1, 2], [], [3], [], []])
it.hasNext()   -> true
it.next()      -> 1
it.next()      -> 2
it.hasNext()   -> true       the empty row is skipped
it.hasNext()   -> true
it.next()      -> 3
it.hasNext()   -> false      only empty rows remain
```

**Constraints**

- `0 <= vec.length <= 500`
- `0 <= vec[i].length <= 500`
- `-1000 <= vec[i][j] <= 1000`
- At most `10^5` calls per test.
