**What this is testing**
The C++ side of a linked list rather than the pointer manipulation (that is `doubly-linked-list`): a sentinel that is part of the object, the iterator protocol (a real `std::bidirectional_iterator`, a `const_iterator` that `iterator` converts to, `insert`/`erase` taking `const_iterator`), node ownership through the rule of five, and the guarantees that make `std::list` worth using at all: iterator stability and O(1) `splice` with no element copied or moved. A strong candidate needs 35-45 minutes; most of the time goes into the iterator boilerplate and the move constructor.

**Approaches**
- Expected: `struct NodeBase { NodeBase* prev; NodeBase* next; }`, `struct Node : NodeBase { T value; }`, members `NodeBase sentinel_` (initialised to point at itself) and `size_t size_`. All link manipulation goes through two helpers, `unlink(n)` and `linkBefore(pos, n)`.
- One iterator template `Iter<bool Const>` holding a `NodeBase*` (or `const NodeBase*`), with the five member types, `*`, `->`, `++`/`--` both ways, a hidden-friend `==`; `iterator = Iter<false>`, `const_iterator = Iter<true>`, plus a converting constructor from `Iter<false>` enabled only for `Const` (declared as `Iter(const Iter<!Const>&) requires Const`, so it is not a copy constructor of `Iter<false>`). `insert`/`erase` need a non-const node from a `const_iterator`: a `const_cast` in one private helper (libstdc++ does the same, `_M_const_cast`), justified because the list itself is non-const.
- `emplace(pos, args...)` does `new Node` with a constructor forwarding to `T`; `insert` and `push_*` call it. `erase` remembers `next`, unlinks, deletes, returns `iterator(next)`.
- Move constructor: `: List() { splice(end(), other); }`. Move assignment: self check, `clear()`, splice. Copy assignment: build a copy, `clear()`, splice it in (strong guarantee), or copy-and-swap with a swap written via splice.
- `reverse`: walk the ring once swapping `prev` and `next` in every node including the sentinel.

**Common wrong turns**
- Sentinel of type `Node` (holding a `T`): does not compile for a `T` without a default constructor (the harness's `Tracked` has none), and constructs a junk `T` otherwise.
- Heap-allocated sentinel: the default constructor allocates and cannot be `noexcept`; a moved-from list needs a new sentinel. (The harness's `heapBlocks()` counts it.)
- Move constructor that copies `other.sentinel_` but does not re-point the first node's `prev` and the last node's `next` at the new sentinel: forward iteration of the new list never reaches its `end()` (the harness reports a walk that does not end), and the destructor walks the old list. Or forgets to reset `other` to empty: both destructors free the same nodes.
- `splice` implemented by copying elements and erasing them from `other`: copies counted, and iterators held into `other` dangle.
- Forgetting the sizes in `splice` (both overloads; the single-element one only when the lists differ), or computing `size()` by walking.
- `splice(pos, *this, it)` with `pos == it` or `pos == next(it)`: unlinking `it` first and then linking before `pos` corrupts the ring when `pos == it`; must be a no-op.
- `reverse` by swapping values: moves elements and changes what each iterator points at.
- `erase` returning the wrong iterator, or `insert` linking after `pos`.
- `const_iterator` missing, or `iterator` not convertible to it, or convertible both ways (static_asserts); missing member typedefs or postfix operators so `std::bidirectional_iterator` is not satisfied.
- `clear()` that deletes the nodes but leaves the sentinel pointing at them.

**Hint ladder**
1. What does `end()` point to? What if the list is empty? What would make `push_front`, `push_back` and `insert` the same operation?
2. The element type has no default constructor. What does the sentinel actually need to contain?
3. Write `unlink` and `linkBefore` first. Which list operations are just those two?
4. When a list is moved, which nodes still point at the old sentinel?
5. `insert` takes a `const_iterator`, but you need to modify the node. Why is that still legitimate, and where should the cast live?

**Follow-ups**
- Why does `std::list` have a member `sort` (and `merge`, `unique`, `remove`)? How would you implement `sort` without moving any element (merge sort on links, O(1) extra space)?
- `size()` was O(n) in some pre-C++11 implementations because of range `splice(pos, other, first, last)`: why do the two requirements conflict?
- Cache behaviour: why is `std::vector` usually faster even for inserts in the middle? When is a list the right choice (stable references, O(1) splice, huge elements, intrusive lists in kernels and allocators)?
- Intrusive lists (`boost::intrusive::list`, the Linux `list_head`): the links live inside the element, so no allocation at all. What changes for ownership?
- Allocator support: rebinding `Allocator<T>` to `Allocator<Node>`. Exception safety of the copy constructor.
- `std::forward_list`: why it has `insert_after`/`erase_after` and `before_begin()`, and no `size()`.
