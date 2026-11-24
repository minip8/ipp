Implement `SharedPtr<T>`, a reference-counted smart pointer with **shared ownership** (a subset of `std::shared_ptr`). Any number of `SharedPtr`s can own the same heap object; the object is deleted when the **last** of them is destroyed, reset or assigned something else. The count of owners lives in a separately allocated **control block** shared by all of them.

Do not use `std::shared_ptr` or `std::unique_ptr`. Define everything at global scope (no namespace). Single-threaded: a plain integer count is fine.

**Required interface**

```cpp
template <class T>
class SharedPtr {
public:
    SharedPtr() noexcept;                          // null, use_count() == 0, allocates nothing
    explicit SharedPtr(T* p);                      // p is never null in the tests
    SharedPtr(const SharedPtr& other);
    SharedPtr& operator=(const SharedPtr& other);
    SharedPtr(SharedPtr&& other) noexcept;
    SharedPtr& operator=(SharedPtr&& other) noexcept;
    ~SharedPtr();

    T* get() const;
    T& operator*() const;
    T* operator->() const;
    explicit operator bool() const;
    long use_count() const;

    void reset();
    void reset(T* p);
    void swap(SharedPtr& other);
};
```

- `SharedPtr(p)` takes ownership of `p` and allocates **one** control block with `new` (count `1`). If that allocation throws `std::bad_alloc`, the constructor **deletes `p`** and lets the exception propagate (so it must not be `noexcept`).
- Copying shares ownership: both pointers point to the same object and `use_count()` goes up by one. A copy never allocates.
- Moving transfers this pointer's share: the source becomes null and the count is unchanged.
- Destroying an owner, `reset()`, or assigning over it gives up its share. When the count reaches `0`, the object is deleted **and** the control block is freed.
- `a = b` must work when `a` and `b` are the same object (`a = a`) or already share the same object; so must `a = std::move(a)`, which leaves `a` unchanged.
- `reset(p)` gives up the current share and starts owning `p` with a new control block. `reset()` makes the pointer null.
- `use_count()` is the number of `SharedPtr`s sharing the object, or `0` for a null pointer. `get`, `*`, `->` and `bool` behave as for a raw pointer.
- `swap(other)` exchanges the two pointers' contents; counts do not change.

The copy/move signatures, `explicit`, and the `noexcept` requirements are checked at compile time; a mismatch is a compile error that says what is wrong.

**How the tests work**

A hidden harness has **eight slots** (`0`..`7`), each either empty or holding one `SharedPtr<Tracked>`. `Tracked` is a small object with an integer `value`; the harness records every `Tracked` that is constructed and destroyed, and it counts the heap blocks your code allocates with `new` and has not yet freed. Each test call performs one C++ operation:

| Test call | What the harness does |
|---|---|
| `make(s, v)` | `slots[s].emplace(new Tracked(v))` (any `SharedPtr` already in slot `s` is destroyed first) |
| `makeNull(s)` | `slots[s].emplace()` |
| `copyConstruct(a, b)` | `slots[b].emplace(*slots[a])` (`a != b`) |
| `copyAssign(a, b)` | `*slots[b] = *slots[a]` (`a` may equal `b`) |
| `moveConstruct(a, b)` | `slots[b].emplace(std::move(*slots[a]))` (`a != b`) |
| `moveAssign(a, b)` | `*slots[b] = std::move(*slots[a])` (`a` may equal `b`) |
| `reset(s, v)` | `slots[s]->reset(new Tracked(v))` |
| `resetNull(s)` | `slots[s]->reset()` |
| `swap(a, b)` | `slots[a]->swap(*slots[b])` (`a` may equal `b`) |
| `destroy(s)` | destroys the `SharedPtr` in slot `s` (its destructor runs); the slot becomes empty |
| `destroyAll()` | `destroy` every non-empty slot, in slot order |
| `constructFailingAlloc(v)` | `SharedPtr<Tracked> tmp(new Tracked(v));` with the next `new` made by your code failing with `std::bad_alloc`; returns whether the exception reached the harness |
| `value(s)` | `slots[s]->value` read through `operator->`, or `-1` if the pointer is null (`-2` if it points to an object that was already deleted) |
| `isNull(s)` | `!*slots[s]` |
| `useCount(s)` | `slots[s]->use_count()` |
| `alive()` | the number of `Tracked` objects currently alive |
| `destroyed()` | the values of all `Tracked` objects destroyed so far in this test, in order |
| `heapBlocks()` | heap blocks allocated by your code and not yet freed (expected: one control block per live object) |
| `errors()` | problems the harness detected, such as an object deleted twice or a control block freed twice; `[]` when everything is correct |

Most tests end with `destroyAll()`, `alive()` and `heapBlocks()` (both expected `0`: nothing leaked) and `errors()` (expected `[]`).

**Example**

```
make(0, 7)
copyConstruct(0, 1)
copyConstruct(1, 2)     three owners of 7
useCount(0)     -> 3
heapBlocks()    -> 1    one control block
destroy(0)
useCount(2)     -> 2
value(1)        -> 7
destroy(1)
destroyed()     -> []   slot 2 still owns 7
destroy(2)
destroyed()     -> [7]
```

**Constraints**

- C++23 (GCC). At most `300` calls per test; values are distinct non-negative integers.
- Allocate the control block with `new` (not `malloc`) so the tests can see it.
