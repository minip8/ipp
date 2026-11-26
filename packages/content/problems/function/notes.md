**What this is testing**
Type erasure, the technique behind `std::function`, `std::any` and polymorphic allocators: a constructor template is the only place that knows the callable's type, so it must package up everything the object will ever need to do with it (call, copy, destroy) behind a type-independent interface. Alongside that: partial specialisation on a function type, perfect forwarding (into storage and through the call), `if constexpr` for `void`, and the overload-resolution trap where a forwarding constructor beats the copy constructor. A strong candidate needs 30-40 minutes; it is hard mostly because several separate ideas must all be right at once.

**Approaches**
- Expected: `template <class> class Function;` plus `template <class R, class... Args> class Function<R(Args...)>`. A private abstract base (`virtual R call(Args&&...) = 0; virtual std::unique_ptr<Base> clone() const = 0; virtual ~Base()`) and a `template <class F> struct Holder : Base { F f; ... }`. The class stores one `std::unique_ptr<Base>`. Copy constructor clones; move operations and the destructor can be `= default`; copy assignment is copy-and-swap; converting assignment is `Function(std::forward<F>(f)).swap(*this)`.
- Hand-rolled vtable: `void* obj_` plus a pointer to a static struct of function pointers (`call`, `clone`, `destroy`) instantiated per `F`. Equivalent, avoids the virtual base, and is closer to what library implementations do; ask the candidate to compare (one indirection either way; the hand-rolled table can live in static storage, and is the natural step towards SBO).
- The converting constructor needs `requires (!std::is_same_v<std::remove_cvref_t<F>, Function> && std::is_invocable_r_v<R, std::decay_t<F>&, Args...>)` (or the equivalent `enable_if`). Store `std::decay_t<F>` so a function becomes a function pointer and a `const Acc&` becomes an `Acc`.
- The call: `if constexpr (std::is_void_v<R>) std::invoke(f, std::forward<Args>(args)...); else return std::invoke(f, std::forward<Args>(args)...);` (`std::invoke_r<R>` in C++23 does both). Plain `f(std::forward<Args>(args)...)` is fine for the tests; `std::invoke` also handles pointers to members.
- Raw `Base*` with a hand-written rule of five is fine too; then watch the moved-from pointer and self-assignment.

**Common wrong turns**
- Unconstrained `template <class F> Function(F&&)`: `Function g(f)` with a non-const `f` picks the template (with `F = Function&` it binds a `Function&`, which beats binding the copy constructor's `const Function&`), so `g` wraps `f` instead of copying it (copying an empty `Function` gives a non-empty one; with recursion through the holder it can even overflow the stack). The harness's `copyConstruct` uses a non-const lvalue on purpose; the static_assert catches the missing invocability constraint.
- Shallow copy: `std::shared_ptr<Base>` copied on `Function` copy. Two Functions share one callable and its state (`copies()` is 0, the second `call` sees the first's total).
- Virtual `call` declared `const`, so the stored functor is called as const: does not compile for a `mutable` lambda, and for a functor with both overloads silently calls the wrong one (the harness's `Acc` reports it). `std::function::operator()` is `const` but calls the target as non-const; ask what that means for thread safety and const-correctness.
- Forgetting `std::forward` in `operator()` or in `Holder::call` (`argCopies` is non-zero; a move-only argument would not compile). Taking `Holder(F f)` by value and moving: an extra move per construction.
- `return f(args...)` with `R = void` and a callable that returns a value: compile error in `Function<void(int&)>`. Needs `if constexpr`.
- Copy constructor that dereferences `other`'s pointer without checking for empty (crash on `copyConstruct` of an empty slot). Move constructor that does not null the source (double destroy). Copy assignment `delete p_; p_ = other.p_->clone();` without a self check (self-assignment clones a destroyed object).
- Throwing something other than `std::bad_function_call` when empty, or returning `R{}`.

**Hint ladder**
1. What is the type of a `Function<int(int)>` that holds a lambda? What is the type of the lambda? Where in your code do you still know the lambda's type?
2. Later, in the copy constructor, you need to copy the callable without knowing its type. What can the converting constructor leave behind that knows how?
3. Try an abstract base class with a virtual `call`, and a class template derived from it that holds an `F`. What other virtual functions does it need for copying and destruction?
4. Which constructor is chosen for `Function g(f)` when `f` is a non-const `Function`? How do you take your template out of the running?
5. What does `return expr;` do in a function returning `void` when `expr` is an `int`?

**Follow-ups**
- Small-buffer optimisation: store small, nothrow-movable callables inline (libstdc++ uses 16 bytes; a lambda capturing one pointer fits). What changes? (Moves now move the callable and may throw unless restricted to nothrow-movable types; the inline buffer needs alignment; the type-erased interface gains a "move into this buffer" operation.) Why do libraries only store nothrow-movable types inline?
- `std::move_only_function` (C++23): why it exists (a `std::function` cannot hold a lambda capturing a `unique_ptr`, because copy must be possible), and how it fixes const-correctness by encoding `const`/`noexcept`/ref-qualifiers in the signature.
- `target<T>()` and `target_type()`: type queries after erasure, with `typeid` or a per-type tag.
- Cost: one heap allocation per `Function`, an indirect call that cannot be inlined, no `noexcept` on the call. When is a template parameter `F` (or `std::function_ref`, C++26) better? Why do low-latency code bases often ban `std::function` on the hot path?
- A null function pointer or empty `Function` passed to the converting constructor: `std::function` stores nothing (it is empty). How would you implement that?
- Thread safety: two threads calling the same `const Function&` with a stateful callable.
