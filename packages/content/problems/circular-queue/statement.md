Implement a fixed-capacity FIFO queue backed by a single array that wraps around (a ring buffer). Do not use your language's built-in queue or deque types, and do not shift elements: every operation must run in **O(1)** time.

- `CircularQueue(capacity)` creates an empty queue that can hold up to `capacity` values.
- `enqueue(value)` appends `value` at the back. Returns `true` on success, or `false` (and changes nothing) if the queue is full.
- `dequeue()` removes the value at the front. Returns `true` on success, or `false` if the queue is empty.
- `front()` returns the value at the front, or `-1` if the queue is empty.
- `rear()` returns the value at the back (the most recently enqueued value still present), or `-1` if the queue is empty.
- `isEmpty()` returns whether the queue holds no values.
- `isFull()` returns whether the queue holds exactly `capacity` values.

**Example**

```
CircularQueue q(3)
q.enqueue(1)  -> true
q.enqueue(2)  -> true
q.enqueue(3)  -> true
q.enqueue(4)  -> false     full
q.rear()      -> 3
q.isFull()    -> true
q.dequeue()   -> true      removes 1
q.enqueue(4)  -> true      reuses the freed slot
q.front()     -> 2
q.rear()      -> 4
```

**Constraints**

- `1 <= capacity <= 1000`
- `0 <= value <= 10^6` (so `-1` never collides with a stored value)
- At most `10^4` calls per test.
