Implement `Vector<T>`, a growable array (a subset of `std::vector`), the way the standard library does it: **storage and object lifetime are separate**. The vector allocates raw memory for `capacity()` elements but only the first `size()` slots hold constructed objects. `T` need not have a default constructor, and no `T` may ever be default-constructed, assigned to raw memory, or destroyed twice.

Do not use `std::vector`, `std::deque` or other containers inside your class. Define everything at global scope (no namespace).

**Required interface**

```cpp
template <class T>
class Vector {
public:
    Vector() noexcept;                         // empty, capacity 0, allocates nothing
    Vector(const Vector& other);
    Vector& operator=(const Vector& other);
    Vector(Vector&& other) noexcept;
    Vector& operator=(Vector&& other) noexcept;
    ~Vector();

    void push_back(const T& value);
    void push_back(T&& value);
    template <class... Args> T& emplace_back(Args&&... args);   // returns the new element
    void pop_back();                                            // never called when empty

    T& operator[](std::size_t i);              // i < size()
    const T& operator[](std::size_t i) const;
    T& at(std::size_t i);                      // throws std::out_of_range if i >= size()
    const T& at(std::size_t i) const;

    std::size_t size() const;
    std::size_t capacity() const;
    bool empty() const;
    void reserve(std::size_t n);
    void clear();

    T* begin();  T* end();                     // pointers to the first / one past the last element
    const T* begin() const;  const T* end() const;
};
```

**Behaviour**

- **Storage**: get raw memory with `::operator new(n * sizeof(T))` (or `std::allocator<T>`), not `malloc` and not `new T[n]`; build elements in it with placement new and end them with an explicit destructor call. The tests count your heap blocks.
- **Growth**: when an element is added to a full vector, the capacity becomes `1` if it was `0` and doubles otherwise. `reserve(n)` reallocates to exactly `n` if `n > capacity()` and does nothing otherwise. Nothing else changes the capacity except as listed below; `pop_back` and `clear` keep it.
- **Reallocation** moves every existing element into the new storage exactly once (move construction), then destroys the old elements and frees the old storage.
- `push_back(v[i])` and `emplace_back` with arguments referring into the vector itself must work even when they trigger a reallocation.
- **Copy constructor**: a new vector with capacity `other.size()` (no allocation if it is empty), each element copy-constructed.
- **Copy assignment**: afterwards the target holds copies of `other`'s elements; its old elements are destroyed or reused by copy assignment. Its capacity afterwards is up to you. `v = v` leaves `v` unchanged.
- **Move constructor / move assignment**: take over `other`'s storage without touching any element (move assignment first destroys the target's own elements and frees its storage). `other` is left empty with capacity `0`. `v = std::move(v)` leaves `v` unchanged.
- `pop_back`, `clear` and the destructor destroy each element exactly once.

**Exact element operations.** Each operation performs only these operations on `T` and no others (no temporaries, no extra copies or moves):

| Operation | Operations on `T` |
|---|---|
| `push_back(const T&)` | one copy construction (plus the moves of a reallocation, if any) |
| `push_back(T&&)` | one move construction (plus reallocation moves) |
| `emplace_back(args...)` | one construction from `std::forward<Args>(args)...` (plus reallocation moves) |
| reallocation (growth or `reserve`) | one move construction per existing element, then one destruction per old element |
| copy constructor | one copy construction per element of `other` |
| copy assignment | one copy (construction or assignment) per element of `other`, no moves; destroys the target's surplus elements |
| move constructor / move assignment | none (move assignment destroys the target's old elements) |

**How the tests work**

A hidden harness has **four slots** (`0`..`3`), each either empty or holding one `Vector<Tracked>`. `Tracked` holds an integer `value`, has **no default constructor**, a counted copy constructor and copy assignment, and a counted `noexcept` move constructor and move assignment (a moved-from `Tracked` has value `-1`). The harness knows the address of every live `Tracked`, so it notices an element that was never constructed or is destroyed twice. Each test call performs one C++ operation:

| Test call | What the harness does |
|---|---|
| `create(s)` | `slots[s].emplace()` (any `Vector` already in slot `s` is destroyed first) |
| `pushCopy(s, v)` | `Tracked t(v); slots[s]->push_back(t);` |
| `pushMove(s, v)` | `Tracked t(v); slots[s]->push_back(std::move(t));` |
| `emplace(s, v)` | `slots[s]->emplace_back(v, Label{})` (constructs `Tracked(int, Label&&)`; `Label{}` is an rvalue that must arrive as one); returns the returned element's value |
| `pushOwn(s, i)` | `slots[s]->push_back((*slots[s])[i])` |
| `pop(s)` | `slots[s]->pop_back()` |
| `get(s, i)` | `(*slots[s])[i].value` |
| `at(s, i)` | `slots[s]->at(i).value`, or `-1` if it throws `std::out_of_range` (`i` may be negative: it is converted to `std::size_t`) |
| `size(s)`, `capacity(s)` | `slots[s]->size()`, `slots[s]->capacity()` |
| `reserve(s, n)`, `clear(s)` | `slots[s]->reserve(n)`, `slots[s]->clear()` |
| `contents(s)` | the values of all elements, read by iterating from `begin()` to `end()` |
| `copyConstruct(a, b)` | `slots[b].emplace(*slots[a])` (`a != b`) |
| `copyAssign(a, b)` | `*slots[b] = *slots[a]` (`a` may equal `b`) |
| `moveConstruct(a, b)` | `slots[b].emplace(std::move(*slots[a]))` (`a != b`) |
| `moveAssign(a, b)` | `*slots[b] = std::move(*slots[a])` (`a` may equal `b`) |
| `destroy(s)`, `destroyAll()` | destroy the `Vector` in slot `s` / in every slot, in slot order |
| `alive()` | the number of `Tracked` objects currently alive |
| `copies()`, `moves()` | the number of `Tracked` copies (constructions + assignments) and moves so far in this test |
| `heapBlocks()` | heap blocks allocated by your code and not yet freed |
| `errors()` | problems the harness detected (an element destroyed twice, assigned to raw memory, copied from a dead object, an rvalue not forwarded, storage freed twice); `[]` when everything is correct |

A value of `-2` from `get`, `at` or `contents` means the element read is not alive; `-3` means an element was copied or moved from an object that was not alive. Most tests end with `destroyAll()`, `alive()` and `heapBlocks()` (both expected `0`) and `errors()` (expected `[]`).

**Example**

```
create(0)
capacity(0)     -> 0
heapBlocks()    -> 0     an empty Vector allocates nothing
pushMove(0, 10)          capacity 0 -> 1
capacity(0)     -> 1
pushMove(0, 11)          capacity 1 -> 2: 10 is moved into the new storage
capacity(0)     -> 2
pushMove(0, 12)          capacity 2 -> 4: 10 and 11 are moved
capacity(0)     -> 4
moves()         -> 6     3 pushes + 1 + 2 relocations
copies()        -> 0
contents(0)     -> [10, 11, 12]
alive()         -> 3
```

**Constraints**

- C++23 (GCC). At most `2500` calls per test; vectors hold at most a few thousand elements.
