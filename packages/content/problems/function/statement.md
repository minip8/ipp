Implement `Function<R(Args...)>`, a polymorphic function wrapper (a subset of `std::function`). A `Function<int(int)>` can hold **any** callable that can be called with an `int` and returns something convertible to `int` (a function, a lambda with captures, a functor object), and it is one type no matter which callable it holds. Storing a callable whose type is known only inside a constructor template, and copying, calling and destroying it later through that one type, is **type erasure**.

Do not use `std::function`, `std::move_only_function`, `std::any` or `std::shared_ptr`. `std::unique_ptr` and `std::invoke` are fine. Define everything at global scope (no namespace).

**Required interface**

```cpp
template <class Signature>
class Function;                                // declared only: just the specialisation below exists

template <class R, class... Args>
class Function<R(Args...)> {
public:
    Function() noexcept;                       // empty
    Function(std::nullptr_t) noexcept;         // empty
    template <class F> Function(F&& f);        // stores a std::decay_t<F> made from std::forward<F>(f)
    Function(const Function& other);
    Function& operator=(const Function& other);
    Function(Function&& other) noexcept;
    Function& operator=(Function&& other) noexcept;
    template <class F> Function& operator=(F&& f);
    Function& operator=(std::nullptr_t) noexcept;
    ~Function();

    explicit operator bool() const noexcept;   // true when it holds a callable
    R operator()(Args... args) const;
    void swap(Function& other) noexcept;
};
```

**Behaviour**

- The **converting constructor** stores its own object of type `std::decay_t<F>` (so a function is stored as a function pointer), constructed from `std::forward<F>(f)`. It is not `explicit`, and it takes part in overload resolution only when `std::decay_t<F>` is not `Function` itself and `std::decay_t<F>&` can be called with `Args...` and returns something convertible to `R` (`std::is_invocable_r_v`). The converting assignment has the same constraint and behaves like `Function(std::forward<F>(f)).swap(*this)`.
- **Storage**: every non-empty `Function` owns exactly one heap block holding its callable (no small-buffer optimisation), allocated with `new` (or `std::make_unique`). An empty `Function` allocates nothing.
- `f(args...)` calls the stored callable as a **non-const lvalue** (a functor or `mutable` lambda may change its own state, and that state persists from call to call), passing each argument on with `std::forward<Args>(args)`, and returns its result converted to `R`. When `R` is `void` the callable's result, if any, is discarded. Calling an empty `Function` throws `std::bad_function_call` (from `<functional>`).
- **Copy constructor and copy assignment** give the target its own copy of the source's callable (a later call on one does not affect the other); copying an empty `Function` gives an empty one. Copy assignment destroys the target's old callable. `f = f` leaves `f` unchanged.
- **Move constructor and move assignment** take over the source's heap block without touching the callable and leave the source empty. Move assignment destroys the target's old callable. `f = std::move(f)` leaves `f` unchanged.
- `swap` exchanges the two callables; `= nullptr` and the destructor destroy the callable (if any) and free its block. Every stored callable is destroyed exactly once.

**Exact callable operations.** Each operation performs only these operations on the stored callable and no others (no temporaries, no extra copies or moves):

| Operation | Operations on the callable |
|---|---|
| converting constructor or assignment, from an lvalue / an rvalue | one copy construction / one move construction (assignment then destroys the old callable) |
| copy constructor | one copy construction |
| copy assignment | one copy construction, then destroys the target's old callable |
| move constructor, move assignment, `swap` | none (move assignment destroys the target's old callable) |
| `f(args...)` | one call, as a non-const lvalue; no argument is ever copied |

The constructor and assignment signatures, the constraint on the converting ones, `noexcept`, `explicit operator bool` and the `const` call operator are checked at compile time; a mismatch is a compile error that says what is wrong.

**How the tests work**

A hidden harness has **six slots** (`0`..`5`), each either empty or holding one `Function<int(int)>`. Most tests store an `Acc`: a functor holding a running `total` whose call operator (non-const) adds its argument to the total and returns the new total. `Acc` is copy and move constructible (not assignable, like a lambda), and the harness records every `Acc` construction, copy, move, call and destruction by address. Each test call performs one C++ operation:

| Test call | What the harness does |
|---|---|
| `makeEmpty(s)` | `slots[s].emplace()` (any `Function` already in slot `s` is destroyed first) |
| `makeAcc(s, start)` | `slots[s].emplace(Acc(start))` |
| `makeAccCopy(s, start)` | `Acc a(start); slots[s].emplace(a);` |
| `makeLambda(s, k)` | `slots[s].emplace([k](int x) { return x * k; })` |
| `makeFunction(s)` | `slots[s].emplace(twice)` where `int twice(int x) { return 2 * x; }` |
| `copyConstruct(a, b)` | `slots[b].emplace(*slots[a])` (`a != b`; the argument is a non-const lvalue) |
| `copyAssign(a, b)` | `*slots[b] = *slots[a]` (`a` may equal `b`) |
| `moveConstruct(a, b)` | `slots[b].emplace(std::move(*slots[a]))` (`a != b`) |
| `moveAssign(a, b)` | `*slots[b] = std::move(*slots[a])` (`a` may equal `b`) |
| `assignAcc(s, start)` | `*slots[s] = Acc(start)` |
| `assignAccCopy(s, start)` | `Acc a(start); *slots[s] = a;` |
| `assignNull(s)` | `*slots[s] = nullptr` |
| `swap(a, b)` | `slots[a]->swap(*slots[b])` (`a` may equal `b`) |
| `call(s, x)` | `std::as_const(*slots[s])(x)`, or `-1` if it throws `std::bad_function_call` |
| `isEmpty(s)` | `!*slots[s]` |
| `destroy(s)`, `destroyAll()` | destroy the `Function` in slot `s` / in every slot, in slot order |
| `voidCall(x, empty)` | `int v = x; Function<void(int&)> g;` then, unless `empty`, `g = [](int& r) { r *= 3; return r; };` then `g(v)`; returns `v`, or `-1` if `g(v)` throws `std::bad_function_call` |
| `argCopies(x)` | `Function<int(Probe, int&)> f = [](Probe p, int& n) { n += p.v; return p.v; };` then `int n = 0; f(Probe(x), n);` returns how many times a `Probe` was copied |
| `alive()` | the number of `Acc` objects currently alive |
| `copies()`, `moves()` | the number of `Acc` copy and move constructions so far in this test |
| `heapBlocks()` | heap blocks allocated by your code and not yet freed |
| `errors()` | problems the harness detected (a callable destroyed twice, called after it was destroyed, called as `const`, copied from a dead object; a block freed twice); `[]` when everything is correct |

A call result of `-2` means the callable called was not alive; `-3` means it was called as `const`. Most tests end with `destroyAll()`, `alive()` and `heapBlocks()` (both expected `0`) and `errors()` (expected `[]`).

**Example**

```
makeAcc(0, 100)          slot 0 holds an Acc with total 100 (one move)
call(0, 1)       -> 101
copyConstruct(0, 1)      slot 1 gets its own copy of the Acc, total 101
copies()         -> 1
call(1, 10)      -> 111
call(0, 1)       -> 102  the original is unaffected
moveConstruct(1, 2)      slot 2 takes slot 1's callable; slot 1 is empty
call(1, 5)       -> -1   std::bad_function_call
call(2, 5)       -> 116
moves()          -> 1    moving a Function never moves the callable
heapBlocks()     -> 2    one block per non-empty Function
```

**Constraints**

- C++23 (GCC). At most `300` calls per test; `start`, `k` and `x` are non-negative and totals stay well within `int`.
