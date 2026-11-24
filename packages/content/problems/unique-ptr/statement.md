Implement `UniquePtr<T>`, a smart pointer that is the **sole owner** of a heap object (a subset of `std::unique_ptr`), and a `makeUnique` helper. When a `UniquePtr` is destroyed, or stops owning its object for any other reason, it deletes that object. Ownership can be **moved** to another `UniquePtr` but never copied.

Do not use `std::unique_ptr` or `std::shared_ptr`. Define everything at global scope (no namespace).

**Required interface**

```cpp
template <class T>
class UniquePtr {
public:
    UniquePtr() noexcept;                         // null
    explicit UniquePtr(T* p);                     // takes ownership of p (p may be null)
    UniquePtr(const UniquePtr&) = delete;
    UniquePtr& operator=(const UniquePtr&) = delete;
    UniquePtr(UniquePtr&& other) noexcept;
    UniquePtr& operator=(UniquePtr&& other) noexcept;
    ~UniquePtr();

    T* get() const;
    T& operator*() const;
    T* operator->() const;
    explicit operator bool() const;

    T* release();
    void reset(T* p = nullptr);
    void swap(UniquePtr& other);
};

template <class T, class... Args>
UniquePtr<T> makeUnique(Args&&... args);
```

- `get()` returns the owned pointer, or `nullptr`. `*p` and `p->` give the owned object (never called on a null `UniquePtr`). `bool(p)` is `get() != nullptr`.
- The **move constructor** takes the other pointer's object and leaves `other` null.
- **Move assignment** `a = std::move(b)` deletes whatever `a` owned, takes `b`'s object, and leaves `b` null. It must behave like `a.reset(b.release())`; in particular `a = std::move(a)` leaves `a` unchanged.
- `release()` gives up ownership **without deleting**: it returns the pointer and leaves the `UniquePtr` null. The caller now owns the object.
- `reset(p)` makes the `UniquePtr` own `p` and deletes the object it owned before (if any). **Store the new pointer first, then delete the old object**: while the old object's destructor runs, `get()` must already return `p`.
- `swap(other)` exchanges the two owned pointers; nothing is deleted.
- `makeUnique<T>(args...)` returns a `UniquePtr<T>` owning `new T(args...)`, **perfectly forwarding** the arguments (an rvalue argument reaches `T`'s constructor as an rvalue, an lvalue as an lvalue).
- `sizeof(UniquePtr<T>)` must equal `sizeof(T*)`.

Getting the copy/move signatures, `noexcept` on the default constructor and the move operations, `explicit`, and the size right is checked at compile time; a mismatch is a compile error that says what is wrong.

**How the tests work**

The tests never see your class directly. A hidden harness has **eight slots** (`0`..`7`), each either empty or holding one `UniquePtr<Tracked>`. `Tracked` is a small object with an integer `value`; the harness records every `Tracked` that is constructed and destroyed. Each test call performs one C++ operation:

| Test call | What the harness does |
|---|---|
| `make(s, v)` | `slots[s].emplace(new Tracked(v))` (any `UniquePtr` already in slot `s` is destroyed first) |
| `makeNull(s)` | `slots[s].emplace()` (a default-constructed, null `UniquePtr`) |
| `makeUnique(s, v, rvalue)` | `slots[s].emplace(makeUnique<Tracked>(v, label))`, passing `label` as an rvalue (`std::move(label)`) if `rvalue` is true, else as an lvalue. Returns whether `Tracked`'s constructor received it as an rvalue |
| `moveConstruct(a, b)` | `slots[b].emplace(std::move(*slots[a]))` (`a != b`) |
| `moveAssign(a, b)` | `*slots[b] = std::move(*slots[a])` (`a` may equal `b`) |
| `release(s)` | `Tracked* raw = slots[s]->release();` returns `raw->value` (`-1` if `raw` is null), then the harness deletes `raw` itself |
| `reset(s, v)` | `slots[s]->reset(new Tracked(v))` |
| `resetNull(s)` | `slots[s]->reset()` |
| `swap(a, b)` | `slots[a]->swap(*slots[b])` (`a` may equal `b`) |
| `destroy(s)` | destroys the `UniquePtr` in slot `s` (its destructor runs); the slot becomes empty |
| `destroyAll()` | `destroy` every non-empty slot, in slot order |
| `value(s)` | `slots[s]->value` read through `operator->`, or `-1` if the pointer is null (`-2` if it points to an object that was already deleted) |
| `isNull(s)` | `!*slots[s]` |
| `alive()` | the number of `Tracked` objects currently alive |
| `destroyed()` | the values of all `Tracked` objects destroyed so far in this test, in order |
| `errors()` | problems the harness detected, such as a double delete or `reset` deleting before storing the new pointer; `[]` when everything is correct |

Most tests end with `destroyAll()`, `alive()` (expected `0`: nothing leaked) and `errors()` (expected `[]`).

**Example**

```
make(0, 7)              slot 0 owns 7
moveConstruct(0, 1)     slot 1 takes 7 from slot 0
isNull(0)       -> true
value(1)        -> 7
make(2, 8)
moveAssign(1, 2)        slot 2 deletes 8 and takes 7
destroyed()     -> [8]
value(2)        -> 7
isNull(1)       -> true
alive()         -> 1
destroyAll()            deletes 7 (slots 0 and 1 are null and delete nothing)
alive()         -> 0
errors()        -> []
```

**Constraints**

- C++23 (GCC). At most `300` calls per test; values are distinct non-negative integers.
