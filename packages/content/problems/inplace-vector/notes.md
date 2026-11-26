**What this is testing**
Object lifetime in a buffer the class owns, where the boundary between live objects and raw storage moves with every operation. Unlike `vector` there is no reallocation to hide behind (no "build a fresh buffer and move everything"), so `insert`, `erase` and the assignments must work in place and get construct-vs-assign right at the boundary: the slot at `end()` is raw and must be constructed into; slots below it hold objects and must be assigned to; slots that fall off the end must be destroyed. Also: inline storage changes what a move means (O(n), the source keeps its elements), fixed capacity needs a failure rule, and alignment and conditional `noexcept` matter. A long question: 35-45 minutes for a strong candidate. The `vector` problem is the natural companion (heap storage, growth, relocation); this one is about in-place shifting.

**Approaches**
- Storage, either way is fine:
  - `union { T data_[N]; };` (reference): correct size and alignment, no casts, `data_ + i` is ordinary pointer arithmetic. The class must then provide its constructors and destructor (the union's are deleted for non-trivial `T`).
  - `alignas(T) unsigned char buf_[N * sizeof(T)]` with `reinterpret_cast<T*>(buf_)` plus `std::launder` to reach live objects. Ask what `launder` does and why it is needed (the cast pointer does not point to the objects created by placement new). Subtle: `std::launder` requires an object to be there, so laundering `begin()` of an empty vector is technically UB; most implementations do it anyway. A strong candidate may raise this.
- `unchecked_emplace_back` as the one place that constructs at `end()` and bumps the size; `push_back`, `try_push_back`, the copy/move constructors and the "pos == end()" case of `insert` all use it. Check `size_ == N` first, before touching anything.
- `insert(pos, T&&)`: `emplace_back(std::move(back()))`, `std::move_backward(pos, old_end - 1, old_end)`, `*pos = std::move(value)`. `insert(pos, const T&)`: copy `value` into a local and call the move version (simple and alias-safe; libstdc++'s `std::vector::insert` does the same). libc++ instead checks whether `&value` lies in `[pos, end())` and adjusts the pointer by one after the shift: no extra copy. Both pass.
- `erase(first, last)`: `std::move(last, end(), first)`, then `pop_back()` `last - first` times. `erase(pos)` is `erase(pos, pos + 1)`.
- Assignments: one helper "assign the common prefix, construct the rest, destroy the surplus", used with plain iterators for copy and `std::make_move_iterator` for move. Self check for `v = v` (without it, the copy is element self-assignment: harmless but wasteful).
- `capacity()` as `static constexpr`. Moves `noexcept(std::is_nothrow_move_constructible_v<T>)` (and the assignment also needs nothrow move assignment).

**Common wrong turns**
- `T data_[N]` or `std::array<T, N>` as a plain member: default-constructs `N` elements (does not compile here: no default constructor) and destroys all `N` at the end.
- Shifting with `std::move_backward(pos, end(), end() + 1)`: move-*assigns* into the raw slot at `end()` (harness: "assigned to raw storage"). The whole point of the question: the last slot needs construction.
- Shifting with placement new into every slot (constructing on top of live objects), or "construct the new position, destroy the old one" for every element: correct values but the wrong operations, and twice the work. The harness's `ops()` shows the difference.
- `erase` that destroys the erased element and then move-constructs the rest down: same problem in reverse. Or that shifts but forgets to destroy the moved-from tail (`alive()` stays high, a leak for resource-owning `T`).
- `insert(pos, const T&)` that shifts first and then assigns from `value`: if `value` was `v[j]` with `j >= pos`, it now reads the wrong (or moved-from) element (`h-insert-own-element`).
- Checking for full after constructing (or after moving from the argument): on failure a `T` was built and destroyed, or the caller's rvalue was emptied for nothing. The C++26 spec says "no effects" on failure.
- Move constructor that clears the source "to be like `vector`": extra destructions, and not what `inplace_vector` does. Ask why `vector` can leave the source empty for free and this cannot.
- Copy assignment as `clear()` + copy-construct all: correct contents, but destroys and rebuilds objects that could have been assigned (more work; also discards whatever capacity the elements own, e.g. `std::string` buffers).
- Unaligned `unsigned char` buffer (no `alignas`), unconditional `noexcept`, missing `std::forward`.

**Hint ladder**
1. What is in the storage past `size()`? What does `new T[N]`, or `T data_[N]`, put there?
2. When you insert in the middle, which slot holds no object? What is the right operation on it, and on the slots below it?
3. After shifting left in `erase`, what is in the last slot, and what must happen to it?
4. In `a = b`, which of `a`'s slots can be assigned to, which must be constructed, which destroyed?
5. Can a move constructor steal the storage here? What is left in the source afterwards?
6. What if `value` in `insert(pos, value)` is a reference to one of your own elements?

**Follow-ups**
- Exception safety: if a move assignment throws halfway through `insert`, what state is the vector in? Which guarantee can `insert` give for a `T` whose move can throw, and what would it cost to give the strong one?
- Trivially copyable `T` (`int`, PODs): `InplaceVector<int, N>` could itself be trivially copyable, so copies are `memcpy` and it can be passed in registers. How? (C++20: defaulted special members constrained with `requires std::is_trivially_copyable_v<T>`.) Why is that valuable in low-latency code (no heap, no indirection, cache-friendly, trivially relocatable)?
- `N == 0`: what breaks (`T data_[0]` is ill-formed), and how does `std::inplace_vector` specialise it?
- Compare with `small_vector` (inline up to N, then heap): what does the fallback do to `noexcept` move and to iterator stability? Compare with `std::array<std::optional<T>, N>` (wasteful flags, no contiguity guarantee of the values).
- Why did the standard pick throwing `std::bad_alloc` for `push_back` on a full vector, and also add `try_push_back` and `unchecked_push_back` (precondition, no check)? When would you use each?
- `resize(n)` (default-constructs, needs `T` default constructible), `emplace(pos, args...)` (construct into a temporary first: the arguments may alias), range insert.
