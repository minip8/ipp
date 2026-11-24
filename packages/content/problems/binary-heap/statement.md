Implement a **max-heap** of integers stored in an array, like `std::priority_queue`. The point is to write the heap yourself: **do not use your language's heap or priority queue** (`std::priority_queue`, `std::make_heap`/`push_heap`/`pop_heap`, Python's `heapq`, Java's `PriorityQueue`), sorted containers (`std::set`/`multiset`, `TreeMap`, ...) or sorting. A plain growable array (`std::vector`, `ArrayList`, a Python list) is fine for the storage.

The heap is an array `a[0 .. n-1]` where the children of position `i` are `2i + 1` and `2i + 2`, and every element is at least as large as its children. `toArray()` exposes this array, so the operations must follow these rules exactly:

- **Sift up** from position `i`: while `i > 0` and `a[i]` is strictly greater than its parent `a[(i - 1) / 2]`, swap them and continue from the parent.
- **Sift down** from position `i`: pick the larger child of `i` (the left one if the two are equal, or if there is only a left child). If it is strictly greater than `a[i]`, swap them and continue from that child; otherwise stop.

Methods:

- `BinaryHeap()` creates an empty heap.
- `push(value)` appends `value` at position `n` and sifts it up.
- `pop()` removes and returns the largest element: the last element moves to position `0`, the size shrinks by one, and position `0` is sifted down. On an empty heap it returns `-2147483648` (the smallest 32-bit integer: `INT_MIN`, `Integer.MIN_VALUE`, `-2**31`) and changes nothing.
- `top()` returns the largest element without removing it, or `-2147483648` if the heap is empty.
- `size()` returns the number of elements.
- `build(values)` **discards the current contents** and makes a heap of `values` in **O(n)**: copy them into the array in the given order, then sift down every position from `n / 2 - 1` (integer division) down to `0`. Pushing them one at a time is O(n log n) and produces a different array.
- `replaceTop(value)` removes the largest element and adds `value` in a single step: `value` overwrites position `0`, which is then sifted down, and the old top is returned. On an empty heap, `value` is pushed and `-2147483648` is returned.
- `toArray()` returns `a[0 .. n-1]`.

`push`, `pop` and `replaceTop` must run in **O(log n)**, `top` and `size` in O(1), and `build` in O(n).

**Example**

```
BinaryHeap h
h.push(3)                       [3]
h.push(8)                       [8, 3]            8 sifts up past 3
h.push(5)                       [8, 3, 5]
h.push(9)                       [9, 8, 5, 3]
h.top()            -> 9
h.pop()            -> 9         3 moves to the root and sifts down past 8
h.toArray()        -> [8, 3, 5]
h.replaceTop(1)    -> 8         [5, 3, 1]
h.build([1, 2, 3, 4, 5])
h.toArray()        -> [5, 4, 3, 1, 2]
h.size()           -> 5
```

**Constraints**

- `-10^9 <= value <= 10^9`, also for the elements of `values`
- `0 <= values.length <= 3 * 10^4`
- At most `10^4` calls per test.
