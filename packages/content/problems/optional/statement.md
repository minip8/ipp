Implement `Optional<T>`, a value that may or may not be present (a subset of `std::optional`). The value lives **inside the `Optional` object itself**: no heap allocation, ever. An empty `Optional` holds raw, correctly aligned storage with no `T` object in it; an engaged one holds exactly one `T` constructed in that storage. Your job is to manage that object's lifetime by hand: construct it with placement new (or `std::construct_at`) when it starts, destroy it with an explicit destructor call when it ends, and never assign to storage that holds no object.

Do not use `std::optional`, `std::variant`, `std::any` or the heap. The only thing you may use from `<optional>` is the exception type `std::bad_optional_access`. `T` need not have a default constructor. Define everything at global scope (no namespace).

**Required interface**

```cpp
template <class T>
class Optional {
public:
    Optional() noexcept;                      // empty: constructs no T
    Optional(const T& value);                 // engaged: copy-constructs the value
    Optional(T&& value);                      // engaged: move-constructs the value
    Optional(const Optional& other);
    Optional& operator=(const Optional& other);
    Optional(Optional&& other) noexcept(std::is_nothrow_move_constructible_v<T>);
    Optional& operator=(Optional&& other)
        noexcept(std::is_nothrow_move_constructible_v<T> && std::is_nothrow_move_assignable_v<T>);
    ~Optional();

    template <class... Args> T& emplace(Args&&... args);   // returns the new value
    void reset();

    bool has_value() const;
    explicit operator bool() const;           // has_value()
    T& value();                               // throws std::bad_optional_access if empty
    const T& value() const;
    T& operator*();                           // never called on an empty Optional
    const T& operator*() const;
    T* operator->();
    const T* operator->() const;

    template <class U> T value_or(U&& fallback) const;
};
```

**Behaviour**

- **Storage**: the value is stored in the object, in storage suitably aligned for `T` (`alignas(T) unsigned char buf[sizeof(T)]`, or a `union` with a `T` member), plus a flag saying whether it is engaged. `sizeof(Optional<T>)` must be at most `sizeof(T) + alignof(T)`.
- `emplace(args...)` destroys the current value (if any), then constructs a new `T` in place from `std::forward<Args>(args)...` and returns a reference to it. If that constructor throws, the exception propagates and the `Optional` is left **empty** (the old value was already destroyed).
- `reset()` destroys the value if there is one and leaves the `Optional` empty; on an empty `Optional` it does nothing. The destructor destroys the value if there is one, exactly once.
- **Copy constructor**: if `other` is engaged, copy-construct its value; otherwise the new `Optional` is empty.
- **Copy assignment** `a = b` has four cases:

  | `a` | `b` | effect |
  |---|---|---|
  | engaged | engaged | copy-assign the value: `*a = *b` (no destruction, no construction) |
  | empty | engaged | copy-construct `b`'s value into `a`'s storage; `a` becomes engaged |
  | engaged | empty | destroy `a`'s value; `a` becomes empty |
  | empty | empty | nothing |

  `a = a` must leave `a` as it was.
- **Move constructor / move assignment**: the same as copying, with move construction and move assignment of the value in place of the copies. Moving from an engaged `Optional` does **not** make it empty: like `std::optional`, it stays engaged and holds the moved-from value. `a = std::move(a)` must leave `a` as it was.
- `value_or(fallback)` returns a copy of the value if engaged; otherwise it returns `static_cast<T>(std::forward<U>(fallback))`, building `T` from the fallback only in that case.
- `noexcept` exactly as in the interface: the move operations are `noexcept` precisely when `T`'s corresponding operations are.

Every operation performs only the operations on `T` listed above, and no others (no temporaries, no extra copies or moves).

Missing members, wrong return types, a non-`explicit` `operator bool`, the conditional `noexcept`, the alignment and the size are checked at compile time; a mismatch is a compile error that says what is wrong.

**How the tests work**

A hidden harness has **four slots** (`0`..`3`), each either empty (no `Optional` at all) or holding one `Optional<Tracked>`. `Tracked` holds an integer `value`, has **no default constructor**, and has a copy constructor, copy assignment and `noexcept` move constructor and move assignment (a moved-from `Tracked` has value `-1`). The harness knows the address of every live `Tracked` and records every operation your code performs on one. Each test call performs one C++ operation:

| Test call | What the harness does |
|---|---|
| `makeEmpty(s)` | `slots[s].emplace()` (any `Optional` already in slot `s` is destroyed first) |
| `makeCopy(s, v)` | `Tracked t(v); slots[s].emplace(std::as_const(t));` (uses `Optional(const T&)`) |
| `makeMove(s, v)` | `Tracked t(v); slots[s].emplace(std::move(t));` (uses `Optional(T&&)`) |
| `emplace(s, v)` | `slots[s]->emplace(v, Label{})` (constructs `Tracked(int, Label&&)`; `Label{}` is an rvalue that must arrive as one); returns the returned value's `value` |
| `emplaceThrows(s, v)` | `slots[s]->emplace(v, Boom{})`, where the `Tracked(int, Boom)` constructor throws `std::runtime_error`; returns whether the exception reached the harness |
| `reset(s)` | `slots[s]->reset()` |
| `hasValue(s)` | `slots[s]->has_value()` (also checks `operator bool` agrees) |
| `value(s)` | `slots[s]->value().value`, or `-4` if it throws `std::bad_optional_access` (also checks that `*`, `->` and the `const` overloads reach the same object, inside the `Optional`) |
| `valueOr(s, v)` | `slots[s]->value_or(v).value` (the fallback is the `int` `v`) |
| `copyConstruct(a, b)` | `slots[b].emplace(*slots[a])` (`a != b`) |
| `copyAssign(a, b)` | `*slots[b] = *slots[a]` (`a` may equal `b`) |
| `moveConstruct(a, b)` | `slots[b].emplace(std::move(*slots[a]))` (`a != b`) |
| `moveAssign(a, b)` | `*slots[b] = std::move(*slots[a])` (`a` may equal `b`) |
| `destroy(s)`, `destroyAll()` | destroy the `Optional` in slot `s` / in every slot, in slot order |
| `alive()` | the number of `Tracked` objects currently alive |
| `ops()` | the operations your code performed on `Tracked` objects since the previous `ops()`, one entry per operation, grouped in the order `construct` (from an `int`), `copy-construct`, `move-construct`, `copy-assign`, `move-assign`, `destroy`. The harness's own `Tracked` objects (`t` above, the result of `value_or` going away) and self-assignments are not recorded |
| `errors()` | problems the harness detected (a value destroyed twice or never constructed, assigned to raw storage, constructed over a live value, an rvalue not forwarded); `[]` when everything is correct |

A value of `-2` from `value` or `valueOr` means the object read is not alive; `-3` means a value was copied or moved from an object that was not alive. Most tests end with `destroyAll()`, `alive()` (expected `0`: nothing leaked) and `errors()` (expected `[]`).

**Example**

```
makeCopy(0, 1)
makeCopy(1, 2)
ops()           -> ["copy-construct", "copy-construct"]
copyAssign(0, 1)         both engaged: assign
ops()           -> ["copy-assign"]
value(1)        -> 1
makeEmpty(2)
copyAssign(0, 2)         slot 2 was empty: construct
ops()           -> ["copy-construct"]
moveConstruct(0, 3)
hasValue(0)     -> true  still engaged, holding a moved-from value
value(0)        -> -1
alive()         -> 4
```

**Constraints**

- C++23 (GCC). At most `300` calls per test.
