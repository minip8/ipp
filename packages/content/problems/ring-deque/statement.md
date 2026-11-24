Implement a double-ended queue of integers with no size limit, stored in a single **circular buffer** that grows when it is full. Elements can be added and removed at both ends, and read by position.

Manage the storage yourself: **do not use your language's deque, list or growable array** to hold the elements (`std::deque`, `std::list`, `std::vector`, `ArrayDeque`, `ArrayList`, `LinkedList`, `collections.deque`, or Python list methods that change a list's length such as `append`, `insert` and `pop`). Allocate fixed-size blocks (`new int[n]` in C++ or Java, `[0] * n` in Python) and copy elements between them yourself. Returning a built-in list from `toArray` is fine.

Positions are counted from the front: position `0` is the front element and position `size - 1` the back one.

- `RingDeque()` creates an empty deque.
- `pushFront(value)` adds `value` before the front; `pushBack(value)` adds it after the back.
- `popFront()` and `popBack()` remove the element at that end and return it, or return `-1` (changing nothing) if the deque is empty.
- `front()` and `back()` return the element at that end without removing it, or `-1` if the deque is empty.
- `get(index)` returns the element at position `index`, or `-1` if `index` is not in `[0, size)`.
- `size()` returns the number of elements.
- `resize(n, value)` makes the size `n`: if `n` is smaller than the size, elements are removed from the back; if it is larger, copies of `value` are added at the back.
- `toArray()` returns the elements from front to back.

Every operation except `resize` and `toArray` must run in **O(1)** (amortised, for the pushes); `resize` in O(|n - size|) plus any growth. Do not shift elements: when the buffer is full, allocate a larger one (for example twice the size) and copy the elements across, keeping their order. You choose the initial capacity and the growth factor.

**Example**

```
RingDeque d
d.pushBack(2)
d.pushBack(3)
d.pushFront(1)
d.pushFront(0)                  [0, 1, 2, 3]
d.get(1)           -> 1
d.popBack()        -> 3
d.popFront()       -> 0
d.pushBack(9)                   [1, 2, 9]
d.front()          -> 1
d.back()           -> 9
d.get(3)           -> -1
d.resize(5, 4)                  [1, 2, 9, 4, 4]
d.toArray()        -> [1, 2, 9, 4, 4]
```

**Constraints**

- `0 <= value <= 10^9` (so `-1` never collides with a stored value)
- `-10^6 <= index <= 10^6`
- `0 <= n <= 5 * 10^6`; the size never exceeds `5 * 10^6 + 10^4`
- At most `10^4` calls per test.
