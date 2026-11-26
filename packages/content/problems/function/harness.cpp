// interview++ test harness for "function". Appended after the candidate's code in judged runs.
//
// The tests drive FunctionHarness: six numbered slots, each either empty or holding one
// ::Function<int(int)>. Every method performs one C++ operation or reports what happened. The
// callable the tests care about, Acc, is a stateful functor whose every copy, move, call and
// destruction is recorded by address, so type-erasure bugs (a copy that shares the callable, a
// callable destroyed twice or never, a callable invoked as const, an argument copied instead of
// forwarded) show up as wrong values or as entries in errors(). The global operator new/delete
// are replaced so the heap blocks the candidate allocates can be counted; freed blocks are
// quarantined until the next test, so a double free becomes a counted error.

#include <concepts>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <functional>
#include <new>
#include <optional>
#include <stdexcept>
#include <string>
#include <type_traits>
#include <unordered_set>
#include <utility>
#include <vector>

namespace ipp_harness_fn {

// ---------------------------------------------------------------- heap accounting
// Blocks allocated with the global operator new while the candidate's code runs (inside an Op
// scope, outside a Pause scope) are "counted". Plain arrays and integers only: this runs inside
// operator new, before and after main.
struct PtrTable {
    static constexpr std::size_t kCap = std::size_t(1) << 15;  // power of two
    void* slots[kCap];
    std::size_t used;   // live entries + tombstones
    std::size_t count;  // live entries

    static void* tomb() { return reinterpret_cast<void*>(std::uintptr_t(1)); }
    static std::size_t hash(void* p) {
        return std::size_t((std::uintptr_t(p) >> 4) * 0x9E3779B97F4A7C15ull) & (kCap - 1);
    }
    bool insert(void* p) {
        if (used >= kCap / 4 * 3) return false;
        for (std::size_t i = hash(p);; i = (i + 1) & (kCap - 1)) {
            if (slots[i] == nullptr || slots[i] == tomb()) {
                if (slots[i] == nullptr) ++used;
                slots[i] = p;
                ++count;
                return true;
            }
        }
    }
    std::size_t find(void* p) const {
        if (count == 0) return kCap;
        for (std::size_t i = hash(p);; i = (i + 1) & (kCap - 1)) {
            if (slots[i] == nullptr) return kCap;
            if (slots[i] == p) return i;
        }
    }
    bool erase(void* p) {
        std::size_t i = find(p);
        if (i == kCap) return false;
        slots[i] = tomb();
        --count;
        return true;
    }
    template <class F> void clear(F onEach) {
        for (std::size_t i = 0; i < kCap; ++i) {
            if (slots[i] != nullptr && slots[i] != tomb()) onEach(slots[i]);
            slots[i] = nullptr;
        }
        used = count = 0;
    }
};

inline PtrTable g_live;        // counted blocks not yet freed
inline PtrTable g_quarantine;  // counted blocks freed during this test (memory kept)
inline bool g_counting = false;
inline int g_pause = 0;
inline bool g_overflow = false;
inline long g_doubleFrees = 0;
// A Function needs a few dozen bytes; refusing huge requests keeps a runaway bug contained.
inline constexpr std::size_t kMaxBlock = std::size_t(1) << 20;

inline bool counting() { return g_counting && g_pause == 0; }

inline void* allocate(std::size_t n) {
    if (counting() && n > kMaxBlock) throw std::bad_alloc();
    void* p = std::malloc(n ? n : 1);
    if (!p) throw std::bad_alloc();
    if (counting() && !g_live.insert(p)) g_overflow = true;
    return p;
}

inline void deallocate(void* p) noexcept {
    if (!p) return;
    if (g_live.erase(p)) {
        // Keep freed blocks until the next test, so a double free or a late access through a
        // dangling pointer cannot corrupt the heap.
        if (!g_quarantine.insert(p)) std::free(p);
        return;
    }
    if (g_quarantine.find(p) != PtrTable::kCap) {
        ++g_doubleFrees;
        return;
    }
    std::free(p);
}

inline void resetHeap() {
    g_live.clear([](void*) {});  // blocks the previous test leaked: forgotten, not freed
    g_quarantine.clear([](void* p) { std::free(p); });
    g_counting = false;
    g_overflow = false;
    g_doubleFrees = 0;
}

/// The candidate's code runs inside an Op; its heap allocations are counted.
struct Op {
    Op() { g_counting = true; }
    ~Op() { g_counting = false; }
    Op(const Op&) = delete;
    Op& operator=(const Op&) = delete;
};
/// Harness bookkeeping runs inside a Pause, so its own allocations are not counted.
struct Pause {
    Pause() { ++g_pause; }
    ~Pause() { --g_pause; }
    Pause(const Pause&) = delete;
    Pause& operator=(const Pause&) = delete;
};

// ---------------------------------------------------------------- callable lifetimes
struct State {
    std::unordered_set<const void*> live;  // addresses of live Acc objects
    long copies = 0;                       // Acc copy constructions
    long moves = 0;                        // Acc move constructions
    long probeCopies = 0;                  // Probe copy constructions (argument forwarding)
    std::vector<std::string> errors;

    void clear() {
        live.clear();
        copies = moves = probeCopies = 0;
        errors.clear();
    }
    void error(const std::string& e) {
        for (auto& x : errors)
            if (x == e) return;
        if (errors.size() < 20) errors.push_back(e);
    }
};

inline State& state() {
    static State s;
    return s;
}

inline void error(const std::string& e) {
    Pause p;
    state().error(e);
}

inline bool isLive(const void* p) {
    Pause g;
    return state().live.count(p) != 0;
}

/// The stateful callable of the tests: a running total. Each call adds its argument and returns
/// the new total, so a copy that shares state with the original (instead of owning its own
/// copy) is visible. Copy and move constructible, not assignable (like a lambda); a moved-from
/// Acc has total -1.
struct Acc {
    int total;

    explicit Acc(int start) : total(start) { born(); }
    Acc(const Acc& o) : total(readFrom(o, "copied")) {
        born();
        ++state().copies;
    }
    Acc(Acc&& o) noexcept : total(readFrom(o, "moved")) {
        born();
        ++state().moves;
        if (isLive(&o)) o.total = -1;
    }
    Acc& operator=(const Acc&) = delete;
    Acc& operator=(Acc&&) = delete;

    ~Acc() {
        Pause p;
        if (!state().live.erase(this))
            state().error("a callable was destroyed twice, or destroyed without having been constructed");
    }

    int operator()(int x) {
        if (!isLive(this)) {
            error("a callable was called after it was destroyed");
            return -2;
        }
        total += x;
        return total;
    }
    int operator()(int) const {
        error("the stored callable was called as const: Function must call it as a non-const lvalue "
              "(a functor or a mutable lambda may change its own state when called)");
        return -3;
    }

private:
    void born() {
        Pause p;
        if (!state().live.insert(this).second)
            state().error("a callable was constructed on top of a live callable that was never destroyed");
    }
    static int readFrom(const Acc& o, const char* how) {
        if (isLive(&o)) return o.total;
        error(std::string("a callable was ") + how + " from an object that is not alive (already destroyed)");
        return -4;
    }
};

/// An argument type that counts its copies: forwarding must never copy it.
struct Probe {
    int v;
    explicit Probe(int x) : v(x) {}
    Probe(const Probe& o) : v(o.v) { ++state().probeCopies; }
    Probe(Probe&& o) noexcept : v(o.v) {}
    Probe& operator=(const Probe&) = delete;
    Probe& operator=(Probe&&) = delete;
};

inline int twice(int x) { return 2 * x; }

/// Not callable as int(int): Function must not be constructible from it.
struct TakesString {
    int operator()(const std::string&) const { return 0; }
};

using Fn = ::Function<int(int)>;
using VoidFn = ::Function<void(int&)>;

// ---- compile-time requirements (checked before any test runs) ----
template <class X> concept HasSwap = requires(X& a, X& b) { a.swap(b); };

static_assert(std::is_nothrow_default_constructible_v<Fn>,
              "Function() must exist and be noexcept: it creates an empty Function and allocates nothing");
static_assert(std::is_nothrow_constructible_v<Fn, std::nullptr_t>,
              "Function needs `Function(std::nullptr_t) noexcept`, creating an empty Function");
static_assert(std::is_copy_constructible_v<Fn>, "Function needs a copy constructor (it copies the stored callable)");
static_assert(std::is_copy_assignable_v<Fn>, "Function needs a copy assignment operator");
static_assert(std::is_nothrow_move_constructible_v<Fn>, "Function(Function&&) must exist and be noexcept");
static_assert(std::is_nothrow_move_assignable_v<Fn>, "Function::operator=(Function&&) must exist and be noexcept");
static_assert(std::is_constructible_v<Fn, Acc> && std::is_constructible_v<Fn, Acc&> &&
                  std::is_constructible_v<Fn, int (&)(int)>,
              "Function<R(Args...)> needs a converting constructor `template <class F> Function(F&& f)` "
              "accepting any callable (a functor, a lambda, a function)");
static_assert(std::is_convertible_v<Acc, Fn>,
              "the converting constructor must not be explicit: `Function<int(int)> f = callable;` must compile");
static_assert(!std::is_constructible_v<Fn, int> && !std::is_constructible_v<Fn, TakesString>,
              "the converting constructor must be constrained: it takes part in overload resolution only for "
              "a callable that can be called with Args... and returns something convertible to R (so "
              "Function<int(int)> is not constructible from an int or from a callable taking a string)");
static_assert(std::is_assignable_v<Fn&, Acc> && std::is_assignable_v<Fn&, int (&)(int)>,
              "Function needs a converting assignment `template <class F> Function& operator=(F&& f)`");
static_assert(!std::is_assignable_v<Fn&, int>, "the converting assignment must be constrained like the constructor");
static_assert(std::is_nothrow_assignable_v<Fn&, std::nullptr_t>,
              "Function needs `Function& operator=(std::nullptr_t) noexcept`, making it empty");
static_assert(std::is_constructible_v<bool, const Fn&> && !std::is_convertible_v<const Fn&, bool>,
              "Function needs `explicit operator bool() const` (explicit, so `int n = f;` does not compile)");
static_assert(std::is_invocable_v<const Fn&, int>,
              "Function<R(Args...)> needs `R operator()(Args... args) const` (const: calling does not change "
              "which callable a Function holds)");
static_assert(std::is_same_v<std::invoke_result_t<const Fn&, int>, int>, "Function<int(int)>::operator() must return int");
static_assert(std::is_same_v<std::invoke_result_t<const VoidFn&, int&>, void>,
              "Function<void(int&)>::operator() must return void");
static_assert(HasSwap<Fn>, "Function needs `void swap(Function& other)`");

}  // namespace ipp_harness_fn

// Replacements for the global allocation functions (counted while the candidate's code runs).
void* operator new(std::size_t n) { return ipp_harness_fn::allocate(n); }
void* operator new[](std::size_t n) { return ipp_harness_fn::allocate(n); }
void* operator new(std::size_t n, const std::nothrow_t&) noexcept {
    try {
        return ipp_harness_fn::allocate(n);
    } catch (...) {
        return nullptr;
    }
}
void* operator new[](std::size_t n, const std::nothrow_t&) noexcept {
    try {
        return ipp_harness_fn::allocate(n);
    } catch (...) {
        return nullptr;
    }
}
void operator delete(void* p) noexcept { ipp_harness_fn::deallocate(p); }
void operator delete[](void* p) noexcept { ipp_harness_fn::deallocate(p); }
void operator delete(void* p, std::size_t) noexcept { ipp_harness_fn::deallocate(p); }
void operator delete[](void* p, std::size_t) noexcept { ipp_harness_fn::deallocate(p); }
void operator delete(void* p, const std::nothrow_t&) noexcept { ipp_harness_fn::deallocate(p); }
void operator delete[](void* p, const std::nothrow_t&) noexcept { ipp_harness_fn::deallocate(p); }

class FunctionHarness {
    using Acc = ipp_harness_fn::Acc;
    using Probe = ipp_harness_fn::Probe;
    using Fn = ipp_harness_fn::Fn;
    using VoidFn = ipp_harness_fn::VoidFn;
    using Op = ipp_harness_fn::Op;
    static constexpr int kSlots = 6;
    std::optional<Fn> slots_[kSlots];

    static ipp_harness_fn::State& st() { return ipp_harness_fn::state(); }

    std::optional<Fn>& slot(int s) {
        if (s < 0 || s >= kSlots) throw std::invalid_argument("test error: no slot " + std::to_string(s));
        return slots_[s];
    }
    Fn& held(int s) {
        auto& o = slot(s);
        if (!o) throw std::invalid_argument("test error: slot " + std::to_string(s) + " holds no Function");
        return *o;
    }

public:
    FunctionHarness() {
        {
            ipp_harness_fn::Pause p;
            st().clear();
        }
        ipp_harness_fn::resetHeap();
    }
    ~FunctionHarness() {
        Op op;
        for (auto& o : slots_) o.reset();
    }
    FunctionHarness(const FunctionHarness&) = delete;
    FunctionHarness& operator=(const FunctionHarness&) = delete;

    // slots[s].emplace()   (an empty Function; any Function already in slot s is destroyed first)
    void makeEmpty(int s) {
        auto& o = slot(s);
        Op op;
        o.emplace();
    }

    // slots[s].emplace(Acc(start))   (from an rvalue)
    void makeAcc(int s, int start) {
        auto& o = slot(s);
        Op op;
        o.emplace(Acc(start));
    }

    // Acc a(start); slots[s].emplace(a);   (from an lvalue; a is destroyed afterwards)
    void makeAccCopy(int s, int start) {
        auto& o = slot(s);
        Op op;
        Acc a(start);
        o.emplace(a);
    }

    // slots[s].emplace([k](int x) { return x * k; })
    void makeLambda(int s, int k) {
        auto& o = slot(s);
        Op op;
        o.emplace([k](int x) { return x * k; });
    }

    // slots[s].emplace(twice)   (a function; twice(x) returns 2 * x)
    void makeFunction(int s) {
        auto& o = slot(s);
        Op op;
        o.emplace(ipp_harness_fn::twice);
    }

    // slots[to].emplace(*slots[from])   (from != to; *slots[from] is a non-const lvalue)
    void copyConstruct(int from, int to) {
        if (from == to) throw std::invalid_argument("test error: copyConstruct needs two slots");
        Fn& src = held(from);
        auto& dst = slot(to);
        Op op;
        dst.emplace(src);
    }

    // *slots[to] = *slots[from]   (from may equal to)
    void copyAssign(int from, int to) {
        Fn& src = held(from);
        Fn& dst = held(to);
        Op op;
        dst = src;
    }

    // slots[to].emplace(std::move(*slots[from]))   (from != to)
    void moveConstruct(int from, int to) {
        if (from == to) throw std::invalid_argument("test error: moveConstruct needs two slots");
        Fn& src = held(from);
        auto& dst = slot(to);
        Op op;
        dst.emplace(std::move(src));
    }

    // *slots[to] = std::move(*slots[from])   (from may equal to)
    void moveAssign(int from, int to) {
        Fn& src = held(from);
        Fn& dst = held(to);
        Op op;
        dst = std::move(src);
    }

    // *slots[s] = Acc(start)
    void assignAcc(int s, int start) {
        Fn& f = held(s);
        Op op;
        f = Acc(start);
    }

    // Acc a(start); *slots[s] = a;
    void assignAccCopy(int s, int start) {
        Fn& f = held(s);
        Op op;
        Acc a(start);
        f = a;
    }

    // *slots[s] = nullptr
    void assignNull(int s) {
        Fn& f = held(s);
        Op op;
        f = nullptr;
    }

    // slots[a]->swap(*slots[b])   (a may equal b)
    void swap(int a, int b) {
        Fn& x = held(a);
        Fn& y = held(b);
        Op op;
        x.swap(y);
    }

    // std::as_const(*slots[s])(x), or -1 if it throws std::bad_function_call
    int call(int s, int x) {
        const Fn& f = held(s);
        Op op;
        try {
            return f(x);
        } catch (const std::bad_function_call&) {
            return -1;
        }
    }

    // !*slots[s]   (uses explicit operator bool)
    bool isEmpty(int s) {
        const Fn& f = held(s);
        Op op;
        bool empty = !f;
        if (empty == static_cast<bool>(f)) ipp_harness_fn::error("operator! and operator bool disagree");
        return empty;
    }

    // destroys the Function in slot s; the slot becomes empty
    void destroy(int s) {
        held(s);
        Op op;
        slot(s).reset();
    }

    // destroy every non-empty slot, in slot order
    void destroyAll() {
        Op op;
        for (auto& o : slots_) o.reset();
    }

    // int v = x; Function<void(int&)> g; unless empty: g = [](int& r) { r *= 3; return r; };
    // g(v); returns v, or -1 if g(v) throws std::bad_function_call
    int voidCall(int x, bool empty) {
        int v = x;
        Op op;
        VoidFn g;
        if (!empty) g = [](int& r) {
            r *= 3;
            return r;  // a result Function<void(int&)> must discard
        };
        try {
            g(v);
        } catch (const std::bad_function_call&) {
            return -1;
        }
        return v;
    }

    // Function<int(Probe, int&)> f = [](Probe p, int& n) { n += p.v; return p.v; };
    // int n = 0; f(Probe(x), n); returns the number of times a Probe was copied (0 when every
    // argument is forwarded)
    int argCopies(int x) {
        Op op;
        ::Function<int(Probe, int&)> f = [](Probe p, int& n) {
            n += p.v;
            return p.v;
        };
        int n = 0;
        int r = f(Probe(x), n);
        if (r != x || n != x)
            ipp_harness_fn::error("Function<int(Probe, int&)> did not pass its arguments through to the callable");
        return static_cast<int>(st().probeCopies);
    }

    // number of Acc objects currently alive
    int alive() {
        ipp_harness_fn::Pause p;
        return static_cast<int>(st().live.size());
    }

    // Acc copy constructions so far in this test
    int copies() { return static_cast<int>(st().copies); }

    // Acc move constructions so far in this test
    int moves() { return static_cast<int>(st().moves); }

    // heap blocks allocated by Function operations and not yet freed
    int heapBlocks() { return static_cast<int>(ipp_harness_fn::g_live.count); }

    // problems the harness detected; [] when all is well
    std::vector<std::string> errors() {
        ipp_harness_fn::Pause p;
        std::vector<std::string> e = st().errors;
        if (ipp_harness_fn::g_doubleFrees)
            e.push_back(std::to_string(ipp_harness_fn::g_doubleFrees) + " heap block(s) freed twice");
        if (ipp_harness_fn::g_overflow) e.push_back("harness: too many heap allocations to track");
        return e;
    }
};
