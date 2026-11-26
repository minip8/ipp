Implement `InplaceVector<T, N>`, a vector with a **fixed capacity `N` and inline storage** (a subset of C++26 `std::inplace_vector`, also known as `boost::container::static_vector`). The elements live inside the object itself: there is never a heap allocation and never a reallocation. The storage has room for `N` elements, but only the first `size()` slots hold constructed objects; the rest is raw memory. Every operation has to respect that boundary: a slot that holds an object is **assigned** to, a slot that does not is **constructed** into, and each object is destroyed exactly once. `T` need not have a default constructor.

Do not use `std::vector`, `std::array<T, N>` or other containers of `T` inside your class, and do not allocate. Define everything at global scope (no namespace).

**Required interface**

```cpp
template <class T, std::size_t N>   // N >= 1
class InplaceVector {
public:
    InplaceVector() noexcept;                       // empty: constructs no T
    InplaceVector(const InplaceVector& other);
    InplaceVector& operator=(const InplaceVector& other);
    InplaceVector(InplaceVector&& other) noexcept(std::is_nothrow_move_constructible_v<T>);
    InplaceVector& operator=(InplaceVector&& other)
        noexcept(std::is_nothrow_move_constructible_v<T> && std::is_nothrow_move_assignable_v<T>);
    ~InplaceVector();

    static constexpr std::size_t capacity() noexcept;   // N
    std::size_t size() const;
    bool empty() const;

    void push_back(const T& value);                 // throws std::bad_alloc if full
    void push_back(T&& value);
    template <class... Args> T& emplace_back(Args&&... args);   // returns the new element
    T* try_push_back(const T& value);               // nullptr if full
    T* try_push_back(T&& value);
    void pop_back();                                // never called when empty

    T* insert(const T* pos, const T& value);        // returns a pointer to the new element
    T* insert(const T* pos, T&& value);
    T* erase(const T* pos);                         // returns a pointer to the element after
    T* erase(const T* first, const T* last);        // the erased one(s)
    void clear();

    T& operator[](std::size_t i);                   // i < size()
    const T& operator[](std::size_t i) const;
    T* begin();  T* end();                          // pointers to the first / one past the last element
    const T* begin() const;  const T* end() const;
};
```

**Behaviour**

- **Storage**: uninitialised storage for `N` elements inside the object, aligned for `T` (`alignas(T) unsigned char buf[N * sizeof(T)]`, or a `union` with a `T[N]` member), plus the size. Construct elements with placement new (or `std::construct_at`) and end them with an explicit destructor call (or `std::destroy_at`).
- **Full**: `push_back` and `emplace_back` on a full vector (`size() == N`) throw `std::bad_alloc`; `try_push_back` returns `nullptr`; `insert` throws `std::bad_alloc`. In every case nothing is constructed, nothing changes, and an rvalue argument is **not** moved from. Otherwise `try_push_back` behaves like `push_back` and returns a pointer to the new element.
- `pop_back` destroys the last element. `clear` and the destructor destroy each element exactly once.
- `insert(pos, value)`, for `pos` in `[begin(), end()]`, inserts before `pos`:
  - at `pos == end()`, it constructs the new element at the end (copy or move) like `push_back`;
  - otherwise, for `insert(pos, T&&)`: the last element is **move-constructed** into the raw slot at `end()`, the elements in `[pos, end() - 1)` are **move-assigned** one place to the right (from the back), and `value` is **move-assigned** into `*pos`;
  - `insert(pos, const T&)` must produce the same contents, and `value` may refer to an element of this vector (`v.insert(v.begin(), v[2])`): the inserted value is the one `value` had before the call. How you achieve that is up to you (copying `value` into a local first is fine): for this overload only the result is tested, not the exact operations.
- `erase(pos)`, for `pos` in `[begin(), end())`: the elements after `pos` are **move-assigned** one place to the left, then the last element (now moved-from) is **destroyed**. `erase(first, last)` move-assigns the elements in `[last, end())` to `first` onward, then destroys the last `last - first` elements; an empty range does nothing. Both return a pointer to the position where the erased elements were (`first`, or `pos`).
- **Copy constructor**: copy-constructs each element of `other`, in order.
- **Copy assignment** `a = b` (sizes `m` and `n`): copy-**assigns** the first `min(m, n)` elements, then copy-**constructs** `b`'s remaining elements (if `n > m`) or **destroys** `a`'s surplus elements (if `m > n`). `a = a` leaves `a` unchanged.
- **Move constructor / move assignment**: the same as copying, with move construction and move assignment in place of the copies. The storage is inline, so there is nothing to steal: `other` **keeps its size**, holding moved-from elements, until it is cleared or destroyed. `a = std::move(a)` leaves `a` unchanged.
- `capacity()` is `static constexpr` and returns `N`. The `noexcept` specifications are exactly as in the interface.

**Exact element operations.** Each operation performs only these operations on `T` and no others (no temporaries, no extra copies or moves):

| Operation | Operations on `T` |
|---|---|
| `push_back(const T&)` / `push_back(T&&)` / `try_push_back` | one copy / move construction (none if full) |
| `emplace_back(args...)` | one construction from `std::forward<Args>(args)...` (none if full) |
| `insert(pos, T&&)`, `pos == end()` | one move construction |
| `insert(pos, T&&)`, `pos < end()` | one move construction, then `end() - pos` move assignments |
| `erase(pos)` | `end() - pos - 1` move assignments, then one destruction |
| `erase(first, last)`, `first < last` | `end() - last` move assignments, then `last - first` destructions |
| `pop_back` / `clear` / destructor | one destruction per element removed |
| copy constructor | one copy construction per element of `other` |
| copy assignment | `min(m, n)` copy assignments, then `n - m` copy constructions or `m - n` destructions |
| move constructor / move assignment | as for copying, with moves |

**How the tests work**

A hidden harness has **four slots** (`0`..`3`), each either empty or holding one `InplaceVector<Tracked, 6>`. `Tracked` holds an integer `value`, has **no default constructor**, and has a copy constructor, copy assignment and `noexcept` move constructor and move assignment (a moved-from `Tracked` has value `-1`). The harness knows the address of every live `Tracked` and records every operation your code performs on one. Each test call performs one C++ operation:

| Test call | What the harness does |
|---|---|
| `create(s)` | `slots[s].emplace()` (any `InplaceVector` already in slot `s` is destroyed first) |
| `pushCopy(s, v)` | `Tracked t(v); slots[s]->push_back(std::as_const(t));` returns `false` if it threw `std::bad_alloc`, else `true` |
| `pushMove(s, v)` | `Tracked t(v); slots[s]->push_back(std::move(t));` returns as `pushCopy` |
| `emplace(s, v)` | `slots[s]->emplace_back(v, Label{})` (constructs `Tracked(int, Label&&)`; `Label{}` is an rvalue that must arrive as one); returns the new element's value, or `-4` if it threw `std::bad_alloc` |
| `tryPushCopy(s, v)`, `tryPushMove(s, v)` | `slots[s]->try_push_back(std::as_const(t))` / `(std::move(t))` with `Tracked t(v)`; returns whether the result is non-null |
| `pop(s)` | `slots[s]->pop_back()` |
| `insertMove(s, i, v)` | `Tracked t(v); slots[s]->insert(begin() + i, std::move(t))`; returns the index of the returned pointer, or `-4` if it threw `std::bad_alloc` |
| `insertCopy(s, i, v)` | the same with `std::as_const(t)` (its operations are not recorded in `ops()`) |
| `insertOwn(s, i, j)` | `slots[s]->insert(begin() + i, (*slots[s])[j])`, returning as `insertMove` (not recorded in `ops()`) |
| `erase(s, i)` | `slots[s]->erase(begin() + i)`; returns the index of the returned pointer |
| `eraseRange(s, i, j)` | `slots[s]->erase(begin() + i, begin() + j)`; returns the index of the returned pointer |
| `get(s, i)` | `(*slots[s])[i].value` |
| `size(s)`, `clear(s)` | `slots[s]->size()` (also checks `empty()`), `slots[s]->clear()` |
| `contents(s)` | the values of all elements, read by iterating from `begin()` to `end()` (also checks they are inside the object) |
| `copyConstruct(a, b)` | `slots[b].emplace(*slots[a])` (`a != b`) |
| `copyAssign(a, b)` | `*slots[b] = *slots[a]` (`a` may equal `b`) |
| `moveConstruct(a, b)` | `slots[b].emplace(std::move(*slots[a]))` (`a != b`) |
| `moveAssign(a, b)` | `*slots[b] = std::move(*slots[a])` (`a` may equal `b`) |
| `destroy(s)`, `destroyAll()` | destroy the `InplaceVector` in slot `s` / in every slot, in slot order |
| `alive()` | the number of `Tracked` objects currently alive |
| `ops()` | the operations your code performed on `Tracked` objects since the previous `ops()`, one entry per operation, grouped in the order `construct` (from an `int`), `copy-construct`, `move-construct`, `copy-assign`, `move-assign`, `destroy`. The harness's own `Tracked` objects (`t` above), `insertCopy`, `insertOwn` and self-assignments are not recorded |
| `errors()` | problems the harness detected (an element destroyed twice or never constructed, assigned to raw storage, constructed over a live element, copied from a dead object, an rvalue not forwarded or moved from when full); `[]` when everything is correct |

A value of `-2` from `get` or `contents` means the element read is not alive; `-3` means an element was copied or moved from an object that was not alive. Most tests end with `destroyAll()`, `alive()` (expected `0`: nothing leaked) and `errors()` (expected `[]`).

**Example**

```
create(0)
emplace(0, 10)  -> 10
emplace(0, 20)  -> 20
emplace(0, 30)  -> 30
ops()           -> ["construct", "construct", "construct"]
insertMove(0, 1, 15)  -> 1
ops()           -> ["move-construct", "move-assign", "move-assign"]
                   30 is move-constructed into the raw slot 3, 20 is move-assigned to slot 2,
                   15 is move-assigned to slot 1
contents(0)     -> [10, 15, 20, 30]
erase(0, 0)     -> 0
ops()           -> ["move-assign", "move-assign", "move-assign", "destroy"]
contents(0)     -> [15, 20, 30]
moveConstruct(0, 1)
contents(0)     -> [-1, -1, -1]    the source keeps its moved-from elements
alive()         -> 6
```

**Constraints**

- C++23 (GCC). At most `600` calls per test.
