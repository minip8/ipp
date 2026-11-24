Implement a growable array of integers, a small version of `std::vector`. The point of the exercise is to manage the storage yourself, so **do not use your language's built-in growable list** to hold the elements (`std::vector`, `ArrayList`, or Python list methods that change a list's length such as `append`, `insert` and `pop`). Allocate fixed-size blocks of storage (`new int[n]` in C++ or Java, `[0] * n` in Python) and copy elements between them yourself. Returning a built-in list from `toArray` is fine.

The array has a **size** (how many elements it holds) and a **capacity** (how many elements its current storage block can hold, `size <= capacity`). The capacity follows these rules exactly:

- A new array has size `0` and capacity `0`.
- When `pushBack` or `insert` needs room and `size == capacity`, the capacity becomes `1` if it was `0`, and doubles otherwise.
- `reserve(n)` sets the capacity to exactly `n` if `n` is larger than the current capacity, and does nothing otherwise.
- `resize(n, value)` with `n` larger than the capacity sets the capacity to `max(n, 2 * capacity)`.
- `shrinkToFit()` sets the capacity to the current size.
- Nothing else changes the capacity. In particular, removing elements never shrinks it.

Methods:

- `DynamicArray()` creates an empty array.
- `pushBack(value)` appends `value` at the end.
- `popBack()` removes the last element and returns it, or returns `-1` (changing nothing) if the array is empty.
- `get(index)` returns the element at `index`, or `-1` if `index` is not in `[0, size)`.
- `set(index, value)` replaces the element at `index` and returns `true`, or returns `false` (changing nothing) if `index` is not in `[0, size)`.
- `insert(index, value)` inserts `value` so that it ends up at `index`, shifting later elements one place right, and returns `true`. Valid positions are `0 .. size` inclusive (`insert(size, v)` is the same as `pushBack(v)`). Returns `false` (changing nothing) for any other `index`.
- `erase(index)` removes the element at `index`, shifting later elements one place left, and returns the removed value, or returns `-1` (changing nothing) if `index` is not in `[0, size)`.
- `size()` and `capacity()` return the current size and capacity.
- `reserve(n)` and `shrinkToFit()` change the capacity as described above; the elements stay the same.
- `resize(n, value)` makes the size `n`: if `n` is smaller than the size, the elements from position `n` onward are removed; if it is larger, copies of `value` are appended.
- `toArray()` returns the elements in order.

`pushBack` must run in **amortised O(1)** time, `get`, `set`, `popBack`, `size` and `capacity` in O(1), and `insert` and `erase` in O(size - index) plus any growth.

**Example**

```
DynamicArray a
a.capacity()       -> 0
a.pushBack(5)                   capacity 0 -> 1
a.pushBack(6)                   capacity 1 -> 2
a.pushBack(7)                   capacity 2 -> 4
a.capacity()       -> 4
a.insert(0, 4)     -> true      [4, 5, 6, 7], still capacity 4
a.insert(9, 1)     -> false     9 is past the end
a.erase(1)         -> 5         [4, 6, 7]
a.popBack()        -> 7         [4, 6]
a.capacity()       -> 4         removing never shrinks
a.shrinkToFit()
a.capacity()       -> 2
a.get(2)           -> -1
a.toArray()        -> [4, 6]
```

**Constraints**

- `0 <= value <= 10^9` (so `-1` never collides with a stored value)
- `-10^6 <= index <= 10^6`
- `0 <= n <= 10^6`; the size never exceeds `2 * 10^6`
- At most `10^4` calls per test.
