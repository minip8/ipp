**What this is testing**
Ownership as a class invariant: exactly one owner deletes each object, exactly once, and every operation keeps that true, including the awkward cases (moved-from, self-move, null). It is short to write; the signal is in whether the candidate gets the special members right without being prompted and can explain *why* each one looks the way it does. Expect a strong candidate to finish in 15-20 minutes and spend the rest on follow-ups.

**Approaches**
- Expected: one data member `T* ptr_ = nullptr`. Delete copy construction and copy assignment. Move constructor steals the pointer and nulls the source. Destructor `delete ptr_` (deleting null is a no-op, no check needed). `release` swaps out the pointer, `reset(p)` does `old = ptr_; ptr_ = p; delete old;`, move assignment is `reset(other.release()); return *this;` (self-move safe for free), `swap` is `std::swap` of the pointers.
- Alternative move assignment: `if (this != &other) { delete ptr_; ptr_ = other.ptr_; other.ptr_ = nullptr; }` passes the tests; ask what happens if `~T` re-enters this pointer (see reset order below), and steer towards `reset(other.release())`. Move-and-swap (`UniquePtr(std::move(other)).swap(*this)`) is also fine.
- `makeUnique`: `return UniquePtr<T>(new T(std::forward<Args>(args)...));`. The return is a prvalue, so no move happens (guaranteed elision).
- Compile-time checks in the harness: copy operations deleted, `explicit` pointer constructor and `explicit operator bool`, `noexcept` default constructor and move operations, `sizeof(UniquePtr<T>) == sizeof(T*)`. A candidate who fails one gets a static_assert message naming it.

**Common wrong turns**
- Move constructor/assignment that copies the pointer but does not null the source: both delete it (the harness reports a double delete; `isNull` on the source is false).
- Move assignment that overwrites `ptr_` without deleting the old object (leak: `destroyed()` misses it, `alive()` is non-zero at the end).
- `delete ptr_; ptr_ = other.ptr_; ...` without a self check: `p = std::move(p)` deletes the object and leaves a dangling or null pointer.
- `reset` written as `delete ptr_; ptr_ = p;`. Works for simple objects but is wrong: if the old object's destructor reaches this `UniquePtr` again (a node owning the next node, an observer, a destructor that calls `reset`), it sees a pointer to an object being destroyed. The standard specifies assign-then-delete; the harness checks it.
- `release` that deletes, or that forgets to null the pointer (then the destructor deletes an object the caller now owns).
- `makeUnique(Args... args)` by value, or `new T(args...)` without `std::forward`: rvalues arrive as lvalues (extra copies; does not compile for move-only arguments).
- `operator bool` not `explicit`: `int n = p;` and `p + 1` compile.
- Forgetting `noexcept` on the move operations. Ask why it matters (containers like `std::vector` only move elements on reallocation if the move constructor is `noexcept`; otherwise they copy, which a move-only type cannot do).
- Adding a `bool owns_` flag or storing a deleter by value: breaks the size guarantee and is redundant with `ptr_ != nullptr`.

**Hint ladder**
1. Who is responsible for deleting the object, and what must be true of every other `UniquePtr` at that moment?
2. What would the compiler-generated copy constructor do here, and what goes wrong at destruction? What should exist instead?
3. After a move, what must the source hold so that its destructor is harmless?
4. Write `release` and `reset` first; can move assignment be written in terms of them, and does that handle `p = std::move(p)`?
5. In `reset`, the old object's destructor might look at this same `UniquePtr`. Which order of "store new pointer" and "delete old" keeps it consistent?

**Follow-ups**
- Custom deleters: `UniquePtr<T, D>`. How do you keep `sizeof == sizeof(T*)` for an empty deleter like `std::default_delete`? (empty base optimisation, or `[[no_unique_address]]`; `std::unique_ptr` uses a compressed pair.) What about a function-pointer deleter (`fclose`)?
- Array form `UniquePtr<T[]>`: `delete[]`, `operator[]`, no `operator->`; why can't the primary template just be reused?
- Converting move from `UniquePtr<Derived>` to `UniquePtr<Base>`: template constructor constrained on `std::is_convertible_v<U*, T*>`. Why does `Base` need a virtual destructor?
- Why `std::make_unique` instead of `std::unique_ptr<T>(new T(...))`? (pre-C++17 evaluation order: `f(unique_ptr<A>(new A), g())` could leak if `g()` throws; plus no naked `new`.)
- `std::unique_ptr` with an incomplete type (pimpl): why must the destructor of the owning class be defined in the .cpp file?
- Compare with `std::auto_ptr` (copy that transfers ownership) and why it was removed.
- What does a `UniquePtr` cost at runtime compared with a raw pointer? (nothing with an empty deleter; can still not be passed in a register under the Itanium ABI because it has a non-trivial destructor.)
