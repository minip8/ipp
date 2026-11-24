**What this is testing**
Reference counting done carefully: where the count lives, the order of increment and decrement in assignment, freeing both the object and the control block exactly once, and exception safety in the constructor. Weak pointers are deliberately out of scope (see follow-ups); the problem is medium without them. A strong candidate finishes in 25-30 minutes.

**Approaches**
- Expected: two members, `T* ptr_` and `ControlBlock* cb_` (a struct holding `long count`). Constructor allocates the block (`try { cb_ = new ControlBlock{1}; } catch (...) { delete p; throw; }`). Copy constructor copies both pointers and increments if non-null. Move constructor steals both and nulls the source. Destructor: `if (cb_ && --cb_->count == 0) { delete ptr_; delete cb_; }`.
- Assignment by copy-and-swap: `SharedPtr(other).swap(*this); return *this;` (and the same with `std::move(other)` for move assignment). The temporary takes its share before ours is released, so self-assignment and "already sharing" both work without special cases; `reset()` / `reset(p)` are `SharedPtr().swap(*this)` / `SharedPtr(p).swap(*this)`.
- Manual assignment is fine too if it increments the source's count **before** releasing the old one (or checks `cb_ == other.cb_`).
- Variant: the control block holds the `T*` and the `SharedPtr` stores only the block pointer. Fine; it costs an extra indirection on every access, and `std::shared_ptr` keeps both pointers for that reason (and for aliasing).
- `std::make_shared`-style single allocation (object and count in one block) is a follow-up, not required here.

**Common wrong turns**
- Storing the count as a plain member of each `SharedPtr`: copies cannot see each other's changes. The count must be shared, i.e. on the heap.
- Copy assignment that releases first and increments second: `a = a` with count 1 deletes the object, then increments a dangling count (harness: `value` returns -2, double delete in `errors()`).
- Copy or move assignment that forgets to release the old object (leak: `destroyed()` misses it, `alive()`/`heapBlocks()` non-zero at the end).
- Destructor that deletes the object but not the control block (leak of one block per object), or deletes the control block on every destructor call (freed while others still use it; the harness reports blocks freed twice).
- Move constructor that does not null the source: the source's destructor decrements the count a second time.
- `use_count()` dereferencing a null control block, or returning 1 for a null pointer (should be 0).
- Constructor without the `try`/`catch`: if `new ControlBlock` throws, `p` leaks (the hidden `constructFailingAlloc` test). Marking the constructor `noexcept` turns that into `std::terminate`; the harness rejects it at compile time.
- `swap` that exchanges only the object pointer and not the control block.

**Hint ladder**
1. Two copies must agree on how many owners there are. Where can a number live so that both see the same one?
2. What needs to happen in the copy constructor, and in the destructor, for the count to stay right?
3. In `a = b`, you must drop `a`'s share and take one of `b`'s. What goes wrong with `a = a` if you drop first?
4. Can you write assignment in terms of the copy constructor and `swap`?
5. In `SharedPtr(T* p)`, what if `new ControlBlock` throws? Who deletes `p`?

**Follow-ups**
- Thread safety: which operations need to be atomic? (`std::atomic<long>` count; `fetch_add` can be relaxed, the decrement must be acq_rel (or release plus an acquire fence before delete) so the deleting thread sees all writes to the object.) Is a `shared_ptr` object itself safe to assign from two threads? (No; only the control block is.)
- `WeakPtr<T>`: add a weak count to the control block. The object is destroyed when the strong count reaches 0, the control block when both reach 0. Implement `lock()` (must not resurrect an expired object: compare-and-increment only if non-zero) and `expired()`. Why is `weak_ptr` needed? (cycles: parent/child with shared_ptr both ways never frees; observer caches.)
- `makeShared<T>(args...)`: one allocation holding the count and the object (placement new into the block). Trade-off with weak pointers: the object's memory cannot be returned until the last weak pointer goes away.
- Custom deleters and type erasure: `SharedPtr<T>(p, deleter)` without the deleter being part of the type (virtual `destroy()` in the control block). How does `shared_ptr<Base>` created from `new Derived` call the right destructor even without a virtual destructor?
- Aliasing constructor (`shared_ptr<Member>(owner, &owner->member)`) and `enable_shared_from_this`.
- Converting constructors from `SharedPtr<Derived>` and from `UniquePtr<T>&&`.
