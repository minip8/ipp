Implement a doubly linked list of integers, a small version of `std::list`. Each element lives in its own node that points to the next and the previous node. Build the nodes and links yourself: **do not use your language's list, deque or array types to hold the elements** (`std::list`, `std::deque`, `std::vector`, `LinkedList`, `ArrayList`, `ArrayDeque`, a Python list or `collections.deque`). Collecting the values into an array in `toArray` and `toArrayReversed` is fine.

Positions are counted from the front: position `0` is the front element and position `size - 1` the back one.

- `DoublyLinkedList()` creates an empty list.
- `pushFront(value)` adds `value` before the front; `pushBack(value)` adds it after the back.
- `popFront()` and `popBack()` remove the element at that end and return it, or return `-1` (changing nothing) if the list is empty.
- `front()` and `back()` return the element at that end without removing it, or `-1` if the list is empty.
- `get(index)` returns the element at position `index`, or `-1` if `index` is not in `[0, size)`.
- `insert(index, value)` inserts `value` so that it ends up at position `index` (before the element currently there) and returns `true`. Valid positions are `0 .. size` inclusive (`insert(size, v)` is the same as `pushBack(v)`). Returns `false` (changing nothing) for any other `index`.
- `erase(index)` removes the element at position `index` and returns it, or returns `-1` (changing nothing) if `index` is not in `[0, size)`.
- `size()` returns the number of elements.
- `reverse()` reverses the order of the elements by relinking the nodes, in O(n) time and O(1) extra space (do not copy the values out and back).
- `toArray()` returns the elements from front to back, following the `next` links.
- `toArrayReversed()` returns the elements from back to front, following the `prev` links.

`pushFront`, `pushBack`, `popFront`, `popBack`, `front`, `back` and `size` must run in **O(1)**. `get`, `insert` and `erase` walk to the position; walk from whichever end is nearer.

**Example**

```
DoublyLinkedList l
l.pushBack(1)
l.pushBack(2)
l.pushBack(3)
l.pushFront(0)                       [0, 1, 2, 3]
l.insert(2, 9)          -> true      [0, 1, 9, 2, 3]
l.insert(6, 5)          -> false     6 is past the end
l.erase(0)              -> 0         [1, 9, 2, 3]
l.popBack()             -> 3         [1, 9, 2]
l.reverse()                          [2, 9, 1]
l.toArray()             -> [2, 9, 1]
l.toArrayReversed()     -> [1, 9, 2]
l.get(2)                -> 1
l.back()                -> 1
```

**Constraints**

- `0 <= value <= 10^9` (so `-1` never collides with a stored value)
- `-10^4 <= index <= 10^4`
- At most `10^4` calls per test.
