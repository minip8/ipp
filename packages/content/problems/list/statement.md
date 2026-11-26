Implement `List<T>`, a doubly linked list (a subset of `std::list`) with **bidirectional iterators**. Every element lives in its own heap node; the nodes are linked in a ring through a **sentinel** node that marks both ends, so `end()` is an iterator to the sentinel and there are no null checks at the ends. Because elements never move once inserted, iterators to an element stay valid until that element is erased, and operations that rearrange the list (`splice`, `reverse`, moving a whole list) only **relink** nodes.

Do not use `std::list`, `std::forward_list`, `std::vector`, `std::deque` or other containers inside your class. Define everything at global scope (no namespace).

**Required interface**

```cpp
template <class T>
class List {
public:
    class iterator;          // bidirectional; *it is T&
    class const_iterator;    // bidirectional; *it is const T&; an iterator converts to it implicitly
                             // (both may be aliases of one class template)
    List() noexcept;         // empty, allocates nothing
    List(const List& other);
    List& operator=(const List& other);
    List(List&& other) noexcept;
    List& operator=(List&& other) noexcept;
    ~List();

    iterator begin() noexcept;              const_iterator begin() const noexcept;
    iterator end() noexcept;                const_iterator end() const noexcept;
    bool empty() const noexcept;
    std::size_t size() const noexcept;      // O(1)
    T& front();  const T& front() const;    // never called when empty
    T& back();   const T& back() const;

    void push_front(const T& value);        void push_front(T&& value);
    void push_back(const T& value);         void push_back(T&& value);
    iterator insert(const_iterator pos, const T& value);
    iterator insert(const_iterator pos, T&& value);
    template <class... Args> iterator emplace(const_iterator pos, Args&&... args);
    void pop_front();                       // never called when empty
    void pop_back();
    iterator erase(const_iterator pos);     // pos is never end()
    void clear() noexcept;

    void splice(const_iterator pos, List& other);                       // other != *this
    void splice(const_iterator pos, List& other, const_iterator it);    // other may be *this
    void reverse() noexcept;
};
```

**Iterators** must model `std::bidirectional_iterator`: default constructible and copyable, with member types `iterator_category` (`std::bidirectional_iterator_tag`), `value_type` (`T`), `difference_type` (`std::ptrdiff_t`), `pointer` and `reference` (`T*`/`T&`, or `const T*`/`const T&` for `const_iterator`), `operator*` and `operator->` (both `const`), prefix and postfix `++` and `--`, and `==` (`!=` follows in C++20). `List<T>` and `const List<T>` are then ranges usable in a range-for. `++` on `end()` and `--` on `begin()` are never used.

**Behaviour**

- **Sentinel**: the sentinel is a member of the `List` object, not a heap node, and holds no `T` (`T` need not have a default constructor; put the links in a base struct and the value in a derived node). In an empty list it links to itself. Each element is exactly one heap node allocated with `new`.
- `insert(pos, value)` and `emplace(pos, args...)` add one element **before** `pos` and return an iterator to it. `push_front` / `push_back` insert before `begin()` / `end()`.
- `erase(pos)` destroys the element at `pos`, frees its node, and returns an iterator to the element that followed it (`end()` if it was the last). `pop_front`, `pop_back` and `clear` destroy and free likewise.
- `splice(pos, other)` moves **all** of `other`'s elements, in order, before `pos`; `other` becomes empty. `splice(pos, other, it)` moves the one element at `it` (in `other`) before `pos`; if `other` is this list and `pos` is `it` or the position right after `it`, nothing changes. Both run in O(1) and keep `size()` of both lists right.
- `reverse()` reverses the order by relinking the nodes.
- **Iterator validity**: an iterator to an element stays valid, and keeps referring to the same element, until that element is erased (by `erase`, a pop, `clear`, assignment to its list, or its list's destruction), across every other operation: insertions and erasures elsewhere, `splice` (it then refers into the destination list), `reverse`, and moving its list (it then refers into the list moved to). An `end()` iterator always refers to the list it came from.
- **Copy constructor**: copies the elements in order. **Copy assignment**: afterwards the target holds copies of `other`'s elements in order; its old elements are destroyed. `l = l` leaves `l` unchanged.
- **Move constructor / move assignment**: take over `other`'s nodes by relinking them to this list's sentinel (move assignment first destroys the target's own elements); `other` is left empty and usable. `l = std::move(l)` leaves `l` unchanged.

**Exact element operations.** Each operation performs only these operations on `T` and no others (no temporaries, no extra copies or moves):

| Operation | Operations on `T` |
|---|---|
| `push_*(const T&)`, `insert(pos, const T&)` | one copy construction |
| `push_*(T&&)`, `insert(pos, T&&)` | one move construction |
| `emplace(pos, args...)` | one construction from `std::forward<Args>(args)...` |
| `erase`, `pop_*`, `clear`, destructor | destroys each removed element exactly once |
| `splice`, `reverse`, move constructor, move assignment | none (move assignment destroys the target's old elements) |
| copy constructor / copy assignment | one copy (construction or assignment) per element of `other`, no moves; assignment destroys the target's old elements |

The signatures, the iterator requirements, `noexcept` on the default constructor and the move operations, the `iterator` to `const_iterator` conversion (and not the reverse), and const-correctness are checked at compile time; a mismatch is a compile error that says what is wrong.

**How the tests work**

A hidden harness has **four list slots** (`0`..`3`), each either empty or holding one `List<Tracked>`, and **eight iterator slots** (`its[0]`..`its[7]`), each either empty or holding one `List<Tracked>::iterator`. `Tracked` holds an integer `value`, has **no default constructor**, a counted copy constructor and copy assignment, and a counted `noexcept` move constructor and move assignment (a moved-from `Tracked` has value `-1`). The harness knows the address of every live `Tracked`. Each test call performs one C++ operation (`t` below is a local `Tracked t(value)`; it is passed as `std::as_const(t)`, or as `std::move(t)` when `move` is true):

| Test call | What the harness does |
|---|---|
| `create(s)` | `lists[s].emplace()` (any `List` already in slot `s` is destroyed first) |
| `pushBack(s, value, move)`, `pushFront(s, value, move)` | `lists[s]->push_back(t)`, `lists[s]->push_front(t)` |
| `popBack(s)`, `popFront(s)`, `clear(s)`, `reverse(s)` | `lists[s]->pop_back()`, `pop_front()`, `clear()`, `reverse()` |
| `front(s)`, `back(s)`, `size(s)` | `lists[s]->front().value`, `back().value`, `size()` (also comparing the const overloads and `empty()`) |
| `contents(s)` | the values front to back, walking a `const_iterator` from `std::as_const(*lists[s]).begin()` to `end()` with `++` |
| `contentsReversed(s)` | the values back to front, walking an `iterator` from `lists[s]->end()` back to `begin()` with `--` |
| `itBegin(i, s)`, `itEnd(i, s)` | `its[i] = lists[s]->begin()`, `its[i] = lists[s]->end()` |
| `itNext(i)`, `itPrev(i)` | `++its[i]`, `--its[i]` |
| `itPostNext(i)` | `(*its[i]++).value` (the value at the old position) |
| `itGet(i)` | `its[i]->value` (also compared with `(*its[i]).value`) |
| `itEq(i, j)`, `itCopy(i, j)` | `its[i] == its[j]` (also checking `!=`), `its[j] = its[i]` |
| `insert(s, pos, value, move, out)` | `its[out] = lists[s]->insert(its[pos], t)`; returns `its[out]->value` (`out` may equal `pos`) |
| `emplace(s, pos, value, out)` | `its[out] = lists[s]->emplace(its[pos], value, Label{})` (constructs `Tracked(int, Label&&)`; `Label{}` is an rvalue that must arrive as one); returns `its[out]->value` |
| `erase(s, pos, out)` | `its[out] = lists[s]->erase(its[pos])`; returns `its[out]->value`, or `-1` if it is `end()` |
| `splice(s, pos, o)` | `lists[s]->splice(its[pos], *lists[o])` (`o != s`) |
| `spliceOne(s, pos, o, it)` | `lists[s]->splice(its[pos], *lists[o], its[it])` (`o` may equal `s`) |
| `copyConstruct(a, b)`, `moveConstruct(a, b)` | `lists[b].emplace(std::as_const(*lists[a]))`, `lists[b].emplace(std::move(*lists[a]))` (`a != b`) |
| `copyAssign(a, b)`, `moveAssign(a, b)` | `*lists[b] = std::as_const(*lists[a])`, `*lists[b] = std::move(*lists[a])` (`a` may equal `b`) |
| `destroy(s)`, `destroyAll()` | destroy the `List` in slot `s` / in every slot, in slot order |
| `alive()` | the number of `Tracked` objects currently alive |
| `copies()`, `moves()` | the number of `Tracked` copies (constructions + assignments) and moves so far in this test |
| `heapBlocks()` | heap blocks allocated by your code and not yet freed (expected: one per element) |
| `errors()` | problems the harness detected (an element destroyed twice or read after it was destroyed, a walk that does not reach the other end in `size()` steps, an rvalue not forwarded, a block freed twice); `[]` when everything is correct |

The tests only use iterators that are still valid by the rules above, with positions in the list named by `s`. A value of `-2` means the element read is not alive. Most tests end with `destroyAll()`, `alive()` and `heapBlocks()` (both expected `0`) and `errors()` (expected `[]`).

**Example**

```
create(0)
pushBack(0, 10, true)
pushBack(0, 20, true)
pushBack(0, 30, true)
itBegin(0, 0)
itNext(0)                           its[0] -> 20
insert(0, 0, 15, true, 1)   -> 15   before 20: [10, 15, 20, 30]; its[1] -> 15
itGet(0)                    -> 20   its[0] is still valid
erase(0, 1, 2)              -> 20   erases 15; its[2] -> the element after it
create(1)
pushBack(1, 7, true)
itBegin(3, 1)                       its[3] -> 7
splice(1, 3, 0)                     list 0's nodes move before 7: list 1 is [10, 20, 30, 7]
size(0)                     -> 0
itGet(0)                    -> 20   its[0] now refers into list 1
moves()                     -> 5    4 pushes + 1 insert; splice moves nothing
```

**Constraints**

- C++23 (GCC). At most `2500` calls per test; lists hold at most a few thousand elements.
