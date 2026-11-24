**What this is testing**
Whether the candidate understands that allocation and construction are different things in C++: raw storage, placement new, explicit destructor calls, and the rule of five over a buffer of partially constructed objects. Plus move semantics where they matter (relocation on growth) and the classic traps (aliasing on `push_back(v[0])`, self-assignment). This is a long question: 35-45 minutes for a strong candidate, with exception safety as the natural extension.

**Approaches**
- Expected: members `T* data_`, `size_t size_`, `size_t cap_`. Allocate with `static_cast<T*>(::operator new(n * sizeof(T)))`, free with `::operator delete`. `emplace_back` does `::new (data_ + size_) T(std::forward<Args>(args)...)`; `push_back` overloads forward to it. Growth: allocate new storage, construct the new element at `fresh[size_]` first, then move-construct the old elements, destroy them, free the old block. `pop_back`/`clear` call `data_[i].~T()`.
- Copy constructor allocates exactly `other.size()` and copy-constructs; copy assignment by copy-and-swap with an `if (this != &other)` check (a strong candidate notes copy-and-swap is self-safe anyway but copies needlessly); move operations steal the three members and reset the source. All move operations `noexcept`.
- `std::allocator<T>` / `std::allocator_traits` instead of `::operator new` is fine; `std::uninitialized_move` / `std::destroy` from `<memory>` are fine too, but ask what they do.
- Reference: `std::move_if_noexcept` during relocation (copy if the move might throw, for the strong guarantee). The harness's element type has a `noexcept` move, so plain `std::move` passes; good follow-up.

**Common wrong turns**
- `new T[cap]`: default-constructs every slot (does not compile here: the element type has no default constructor), and then `push_back` assigns instead of constructing. The whole point of the question.
- `data_[size_] = value` into raw memory: assignment to an object that does not exist (harness: "assigned to raw memory").
- Copying instead of moving on growth (`T(data_[i])`), or forgetting `std::forward` in `emplace_back` (`moves()`/`copies()` are off; `errors()` names the forwarding bug).
- Forgetting to destroy the old elements after moving them (moved-from objects can still own resources; `alive()` too high), or forgetting to free the old block (`heapBlocks()` too high).
- Aliasing: `push_back(v[0])` on a full vector, implemented as "reserve(2 * cap) then construct from the reference": the reference now points to a moved-from, destroyed object in freed memory. Fix: construct the new element in the new storage before relocating (what libstdc++ does), or copy the argument first (costs an extra move; the spec here rules it out, so ask the candidate why the standard library avoids it).
- `push_back(const T&)` implemented as `T tmp(x); push_back(std::move(tmp));`: correct but an extra move per call (fails the exact-count tests; worth a discussion rather than a verdict).
- Growth `cap + 1` or `cap * 2` with `cap == 0` (stays at 0): quadratic copying, or writing past a zero-size buffer. Ask why geometric growth gives amortised O(1) push_back.
- Move constructor that copies the pointer but does not reset the source: both destructors destroy the same elements and free the same block (harness reports both).
- Move assignment without a self check that frees its own buffer first: `v = std::move(v)` loses everything.
- `at` throwing something other than `std::out_of_range`, or the off-by-one `i > size_`.
- `clear()` freeing the storage (capacity must stay), `reserve(n)` shrinking when `n < capacity()`.

**Hint ladder**
1. If `T` has no default constructor, what does `new T[n]` do? What do you need instead?
2. How do you get memory without constructing anything, and how do you later construct one object at a given address? How do you end its lifetime without freeing the memory?
3. When you run out of room, what happens to the existing elements? Should they be copied? What must happen to the old ones afterwards?
4. Which of your members does a moved-from vector need to reset so its destructor is harmless?
5. What if the argument to `push_back` is a reference to one of your own elements and you need to reallocate? In what order should the new element and the old ones be moved?

**Follow-ups**
- Exception safety: which guarantee does each operation give? If `T`'s copy constructor throws halfway through the copy constructor or a reallocation, what must be cleaned up? Why does `std::vector` use `std::move_if_noexcept`, and what happens to `std::vector<T>` growth when `T`'s move constructor is not `noexcept`?
- `insert`/`erase` in the middle: shifting with move assignment vs. construct/destroy at the boundary; iterator invalidation rules.
- `resize(n)` and `shrink_to_fit`; why is `shrink_to_fit` non-binding?
- Allocator support and `std::allocator_traits` (`construct`, `destroy`, propagation on copy/move/swap). Over-aligned `T` (`::operator new(n, std::align_val_t)`).
- Growth factor: 2 vs 1.5 (memory reuse argument: with 1.5 a later allocation can fit in the sum of freed earlier blocks). Small-buffer optimisation (`small_vector`) and what it does to move semantics (moves are no longer O(1) and pointers are invalidated).
- `std::vector<bool>`: why it is not a container of `bool`.
