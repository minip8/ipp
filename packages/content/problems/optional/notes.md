**What this is testing**
Manual object lifetime in storage the class owns: the difference between storage and object, placement new vs assignment, explicit destructor calls, and the four-way case analysis of copy/move assignment that every sum type needs. Plus the details that separate a careful C++ engineer from a casual one: alignment, conditional `noexcept`, exception safety of `emplace`, and knowing that a moved-from `std::optional` stays engaged. Short to write but easy to get subtly wrong; a strong candidate finishes in 20-30 minutes and discusses trivially-copyable propagation.

**Approaches**
- Expected (reference): an anonymous `union { T value_; };` plus `bool engaged_`. A union member is never constructed or destroyed implicitly, so the class must provide the constructors and destructor itself, and the union gives correct size and alignment with no casts. Construct with `std::construct_at(std::addressof(value_), ...)` or `::new (static_cast<void*>(std::addressof(value_))) T(...)`; destroy with `value_.~T()`.
- Equally good: `alignas(T) unsigned char buf_[sizeof(T)]` and `std::launder(reinterpret_cast<T*>(buf_))` to reach the object. Ask why `std::launder` is there (the pointer obtained by casting the buffer's address does not point to the `T` object created there by placement new; `launder` gives a pointer that does), and why `alignas(T)` matters (without it, `buf_` may be at any address; misaligned access is UB, slow, or a fault on some targets). Storing the pointer returned by placement new in a member also avoids `launder` but costs 8 bytes (fails the size check).
- A private `construct(args...)` that sets the flag only after the constructor returns keeps `emplace` exception-safe for free.
- Assignment: `if (a && b) **this = *other; else if (b) construct(*other); else reset();`. The same with `std::move` for move assignment. No self check is needed: in the both-engaged case it becomes `T`'s self-assignment.
- `emplace`: `reset(); construct(std::forward<Args>(args)...); return value_;`.
- `value_or(U&& u) const`: `return engaged_ ? value_ : static_cast<T>(std::forward<U>(u));` (or with `if`). Taking `const T&` or `T` by value forces a `T` to be built even when engaged, and does not compile here because `Tracked(int)` is explicit.

**Common wrong turns**
- `T value_;` as a plain member: default-constructs `T` (does not compile here: no default constructor) and destroys it unconditionally.
- Destructor or `reset()` that calls `~T()` without checking the flag, or forgets to clear it (destroying an object that is not there; harness: "destroyed twice, or destroyed without having been constructed").
- Copy assignment that always resets and reconstructs: correct contents, but not what `std::optional` does, and it loses the strong guarantee of `T`'s own assignment (if the copy throws, the target has already lost its value). The harness shows `["copy-construct", "destroy"]` instead of `["copy-assign"]`.
- Copy assignment into an empty `Optional` written as `value_ = other.value_`: assigning to an object that does not exist (harness: "assigned to raw storage").
- Resetting the source in the move constructor or move assignment. Sensible-looking, but `std::optional` does not do it, and it adds a destruction the caller did not ask for. Ask why the standard chose this (the move is just `T`'s move; whether a moved-from `T` is "empty" is `T`'s business).
- Setting `engaged_ = true` before constructing: if the constructor throws, the `Optional` claims to hold a value that does not exist and the destructor destroys garbage (`h-emplace-throws`).
- `emplace` that constructs over an engaged value without destroying it first (leak of whatever the old value owned), or that assigns a temporary instead (`["construct", "move-assign", "destroy"]`).
- Unconditional `noexcept` on the move operations: a lie for a `T` whose move can throw (then `std::terminate`), and it misinforms containers that use `std::move_if_noexcept`. No `noexcept` at all: `std::vector<Optional<T>>` copies instead of moving on reallocation.
- Non-`explicit` `operator bool` (`int n = opt;` compiles), missing `std::forward` in `emplace`.

**Hint ladder**
1. If `T` has no default constructor, what can the member that holds the value be? How do you get storage without an object in it?
2. How do you start an object's lifetime at a given address, and how do you end it without freeing anything?
3. Write out the four cases of `a = b` (engaged/empty on each side). In which of them does `a` hold an object you can assign to?
4. If `T`'s constructor throws inside `emplace`, what state is the `Optional` in? Does the order of "set the flag" and "construct" matter?
5. What does `std::optional` do to the source on a move? Why might that be the right choice?

**Follow-ups**
- Triviality propagation: `std::optional<int>` is trivially copyable and trivially destructible. How do you make `Optional<T>` have a trivial destructor when `T` does? (C++20: `~Optional() requires std::is_trivially_destructible_v<T> = default;` next to the non-trivial one; before C++20, a base-class hierarchy selected by `std::conditional`.) Why does it matter (passing in registers, `memcpy`-able, usable in `constexpr`)?
- `std::optional<T&>` (C++26) and why it was controversial (rebind vs assign-through on assignment).
- Converting constructors and assignment from `U&&` (`Optional<std::string> o = "hi";`) and the constraints needed so they do not hijack copy construction.
- Ref-qualified `value() &&` returning `T&&` so `std::move(opt).value()` moves out; `and_then` / `transform` / `or_else` (C++23 monadic operations).
- Compare with `std::variant<std::monostate, T>` and with `std::expected<T, E>`: same storage idea, more alternatives; how does `variant` handle an exception during assignment that changes the alternative (`valueless_by_exception`)?
- Size: why is `sizeof(std::optional<double>)` 16, and how could an "optional with a sentinel value" or a niche (e.g. a pointer's null) make it 8?
