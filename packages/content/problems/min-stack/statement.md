Implement a stack of integers that can also report its smallest element at any moment. Every operation must run in **O(1)** time.

- `MinStack()` creates an empty stack.
- `push(val)` puts `val` on top of the stack.
- `pop()` removes the top element.
- `top()` returns the top element without removing it.
- `getMin()` returns the smallest element currently in the stack.

`pop`, `top` and `getMin` are **never called on an empty stack**. Duplicate values are allowed; popping one copy of the minimum leaves the other copies in place.

**Example**

```
MinStack s
s.push(4)
s.push(2)
s.push(7)
s.getMin()   -> 2
s.push(2)
s.pop()                 removes the second 2
s.getMin()   -> 2       the first 2 is still there
s.pop()                 removes 7
s.pop()                 removes 2
s.getMin()   -> 4
s.top()      -> 4
```

**Constraints**

- `-2^31 <= val <= 2^31 - 1`
- At most `3 * 10^4` calls per test.
