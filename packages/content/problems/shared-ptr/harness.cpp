// interview++ test harness for "shared-ptr". Appended after the candidate's code in judged runs.
//
// The tests drive SharedPtrHarness: eight numbered slots, each either empty or holding one
// ::SharedPtr<Tracked>. Every method performs one C++ operation on the slots or reports what
// happened. Tracked objects record their own lifetimes in harness state, and the global
// operator new/delete are replaced so that heap blocks allocated by the candidate's code (the
// control blocks) can be counted. Freed blocks are quarantined until the next test, so a double
// free or a late access becomes a counted error instead of heap corruption.

#include <concepts>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <new>
#include <optional>
#include <stdexcept>
#include <string>
#include <type_traits>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

namespace ipp_harness_sp {

// ---------------------------------------------------------------- heap accounting
// Blocks allocated with the global operator new while the candidate's code runs (inside an
// Op scope, outside a Pause scope) are "counted". Plain arrays and integers only: this runs
// inside operator new, before and after main.
struct PtrTable {
    static constexpr std::size_t kCap = std::size_t(1) << 17;  // power of two
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
inline bool g_failNext = false;
inline bool g_overflow = false;
inline long g_doubleFrees = 0;

inline bool counting() { return g_counting && g_pause == 0; }

inline void* allocate(std::size_t n) {
    if (counting() && g_failNext) {
        g_failNext = false;
        throw std::bad_alloc();
    }
    void* p = std::malloc(n ? n : 1);
    if (!p) throw std::bad_alloc();
    if (counting() && !g_live.insert(p)) g_overflow = true;
    return p;
}

inline void deallocate(void* p) noexcept {
    if (!p) return;
    if (g_live.erase(p)) {
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
    g_failNext = false;
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

// ---------------------------------------------------------------- object lifetimes
struct State {
    std::unordered_map<const void*, int> live;  // live Tracked objects -> value
    std::unordered_set<void*> allocated;        // blocks from Tracked::operator new, not yet deleted
    std::unordered_set<void*> quarantine;       // deleted Tracked blocks, freed at the next test
    std::vector<int> destroyed;
    std::vector<std::string> errors;

    void clear() {
        for (void* p : quarantine) std::free(p);
        for (void* p : allocated) std::free(p);
        live.clear();
        allocated.clear();
        quarantine.clear();
        destroyed.clear();
        errors.clear();
    }
    ~State() { clear(); }
    void error(std::string e) {
        if (errors.size() < 20) errors.push_back(std::move(e));
    }
};

inline State& state() {
    static State s;
    return s;
}

/// The element type the tests use. Not copyable: only pointers to it are shared.
struct Tracked {
    int value;

    explicit Tracked(int v) : value(v) {
        Pause p;
        State& s = state();
        if (s.live.count(this)) s.error("an object was constructed on top of a live object");
        s.live[this] = v;
    }
    Tracked(const Tracked&) = delete;
    Tracked& operator=(const Tracked&) = delete;

    ~Tracked() {
        Pause p;
        State& s = state();
        auto it = s.live.find(this);
        if (it == s.live.end()) {
            s.error("an object was destroyed twice (double delete)");
            return;
        }
        s.destroyed.push_back(it->second);
        s.live.erase(it);
    }

    static void* operator new(std::size_t n) {
        Pause p;
        void* m = std::malloc(n ? n : 1);
        if (!m) throw std::bad_alloc();
        state().allocated.insert(m);
        return m;
    }
    static void operator delete(void* m) noexcept {
        if (!m) return;
        Pause p;
        State& s = state();
        if (s.allocated.erase(m)) s.quarantine.insert(m);
        else if (!s.quarantine.count(m)) ::operator delete(m);  // from ::new T, not ours
    }
};

using SP = ::SharedPtr<Tracked>;

// ---- compile-time requirements (checked before any test runs) ----
template <class P> concept HasGet = requires(const P& p) { { p.get() } -> std::same_as<Tracked*>; };
template <class P> concept HasDeref = requires(const P& p) {
    { *p } -> std::same_as<Tracked&>;
    { p.operator->() } -> std::same_as<Tracked*>;
};
template <class P> concept HasUseCount = requires(const P& p) { { p.use_count() } -> std::integral; };
template <class P> concept HasReset = requires(P& p, Tracked* raw) {
    p.reset();
    p.reset(raw);
};
template <class P> concept HasSwap = requires(P& a, P& b) { a.swap(b); };

static_assert(std::is_nothrow_default_constructible_v<SP>,
              "SharedPtr<T>() must exist and be noexcept: it creates an empty (null) SharedPtr");
static_assert(std::is_constructible_v<SP, Tracked*>,
              "SharedPtr<T> needs a constructor SharedPtr(T* p) that takes ownership of p");
static_assert(!std::is_convertible_v<Tracked*, SP>,
              "SharedPtr(T* p) must be explicit, so a raw pointer never becomes owned by accident");
static_assert(!std::is_nothrow_constructible_v<SP, Tracked*>,
              "SharedPtr(T* p) allocates a control block, so it must not be noexcept: if the "
              "allocation throws it deletes p and lets std::bad_alloc propagate");
static_assert(std::is_copy_constructible_v<SP> && std::is_copy_assignable_v<SP>,
              "SharedPtr<T> needs a copy constructor and a copy assignment operator");
static_assert(std::is_move_constructible_v<SP> && std::is_move_assignable_v<SP>,
              "SharedPtr<T> needs a move constructor and a move assignment operator");
static_assert(std::is_nothrow_move_constructible_v<SP>, "SharedPtr(SharedPtr&&) must be noexcept");
static_assert(std::is_nothrow_move_assignable_v<SP>, "SharedPtr::operator=(SharedPtr&&) must be noexcept");
static_assert(std::is_constructible_v<bool, const SP&> && !std::is_convertible_v<const SP&, bool>,
              "SharedPtr<T> needs `explicit operator bool() const`");
static_assert(HasGet<SP>, "SharedPtr<T> needs `T* get() const`");
static_assert(HasDeref<SP>, "SharedPtr<T> needs `T& operator*() const` and `T* operator->() const`");
static_assert(HasUseCount<SP>, "SharedPtr<T> needs `long use_count() const`");
static_assert(HasReset<SP>, "SharedPtr<T> needs `void reset()` and `void reset(T* p)`");
static_assert(HasSwap<SP>, "SharedPtr<T> needs `void swap(SharedPtr& other)`");

}  // namespace ipp_harness_sp

// Replacements for the global allocation functions (counted while the candidate's code runs).
void* operator new(std::size_t n) { return ipp_harness_sp::allocate(n); }
void* operator new[](std::size_t n) { return ipp_harness_sp::allocate(n); }
void* operator new(std::size_t n, const std::nothrow_t&) noexcept {
    try {
        return ipp_harness_sp::allocate(n);
    } catch (...) {
        return nullptr;
    }
}
void* operator new[](std::size_t n, const std::nothrow_t&) noexcept {
    try {
        return ipp_harness_sp::allocate(n);
    } catch (...) {
        return nullptr;
    }
}
void operator delete(void* p) noexcept { ipp_harness_sp::deallocate(p); }
void operator delete[](void* p) noexcept { ipp_harness_sp::deallocate(p); }
void operator delete(void* p, std::size_t) noexcept { ipp_harness_sp::deallocate(p); }
void operator delete[](void* p, std::size_t) noexcept { ipp_harness_sp::deallocate(p); }
void operator delete(void* p, const std::nothrow_t&) noexcept { ipp_harness_sp::deallocate(p); }
void operator delete[](void* p, const std::nothrow_t&) noexcept { ipp_harness_sp::deallocate(p); }

class SharedPtrHarness {
    using Tracked = ipp_harness_sp::Tracked;
    using SP = ipp_harness_sp::SP;
    using Op = ipp_harness_sp::Op;
    static constexpr int kSlots = 8;
    std::optional<SP> slots_[kSlots];
    std::optional<SP> scratch_;

    static ipp_harness_sp::State& st() { return ipp_harness_sp::state(); }
    static void error(std::string e) {
        ipp_harness_sp::Pause p;
        st().error(std::move(e));
    }

    std::optional<SP>& slot(int s) {
        if (s < 0 || s >= kSlots) throw std::invalid_argument("test error: no slot " + std::to_string(s));
        return slots_[s];
    }
    SP& held(int s) {
        auto& o = slot(s);
        if (!o) throw std::invalid_argument("test error: slot " + std::to_string(s) + " holds no SharedPtr");
        return *o;
    }

public:
    SharedPtrHarness() {
        ipp_harness_sp::Pause p;
        st().clear();
        ipp_harness_sp::resetHeap();
    }
    ~SharedPtrHarness() {
        Op op;  // the slots' destructors run candidate code
        for (auto& o : slots_) o.reset();
    }
    SharedPtrHarness(const SharedPtrHarness&) = delete;
    SharedPtrHarness& operator=(const SharedPtrHarness&) = delete;

    // slots[s].emplace(new Tracked(value))   (an existing SharedPtr in the slot is destroyed first)
    void make(int s, int value) {
        auto& o = slot(s);
        Tracked* raw = new Tracked(value);
        Op op;
        o.emplace(raw);
    }

    // slots[s].emplace()
    void makeNull(int s) {
        auto& o = slot(s);
        Op op;
        o.emplace();
    }

    // slots[to].emplace(*slots[from])   (from != to)
    void copyConstruct(int from, int to) {
        if (from == to) throw std::invalid_argument("test error: copyConstruct needs two slots");
        SP& src = held(from);
        auto& dst = slot(to);
        Op op;
        dst.emplace(src);
    }

    // *slots[to] = *slots[from]   (from may equal to)
    void copyAssign(int from, int to) {
        SP& src = held(from);
        SP& dst = held(to);
        Op op;
        dst = src;
    }

    // slots[to].emplace(std::move(*slots[from]))   (from != to)
    void moveConstruct(int from, int to) {
        if (from == to) throw std::invalid_argument("test error: moveConstruct needs two slots");
        SP& src = held(from);
        auto& dst = slot(to);
        Op op;
        dst.emplace(std::move(src));
    }

    // *slots[to] = std::move(*slots[from])   (from may equal to)
    void moveAssign(int from, int to) {
        SP& src = held(from);
        SP& dst = held(to);
        Op op;
        dst = std::move(src);
    }

    // slots[s]->reset(new Tracked(value))
    void reset(int s, int value) {
        SP& p = held(s);
        Tracked* raw = new Tracked(value);
        Op op;
        p.reset(raw);
    }

    // slots[s]->reset()
    void resetNull(int s) {
        SP& p = held(s);
        Op op;
        p.reset();
    }

    // slots[a]->swap(*slots[b])   (a may equal b)
    void swap(int a, int b) {
        SP& x = held(a);
        SP& y = held(b);
        Op op;
        x.swap(y);
    }

    // destroys the SharedPtr in slot s (its destructor runs); the slot becomes empty
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

    // { SharedPtr<Tracked> tmp(new Tracked(value)); } where allocating the control block throws
    // std::bad_alloc. Returns whether the constructor let std::bad_alloc propagate.
    bool constructFailingAlloc(int value) {
        Tracked* raw = new Tracked(value);
        bool threw = false;
        {
            Op op;
            ipp_harness_sp::g_failNext = true;
            try {
                scratch_.emplace(raw);  // a member, so the allocation cannot be optimised away
            } catch (const std::bad_alloc&) {
                threw = true;
            }
            ipp_harness_sp::g_failNext = false;
            scratch_.reset();
        }
        return threw;
    }

    // slots[s]->value read through operator->, or -1 if the pointer is null (-2 if it points to an
    // object that was already deleted)
    int value(int s) {
        const SP& p = held(s);
        Tracked* raw;
        bool nonNull;
        {
            Op op;
            raw = p.get();
            nonNull = static_cast<bool>(p);
        }
        if (nonNull != (raw != nullptr)) error("value: operator bool disagrees with get()");
        if (!raw) return -1;
        if (!st().live.count(raw)) {
            error("value: the SharedPtr points to an object that was already deleted");
            return -2;
        }
        Op op;
        if (&*p != raw || p.operator->() != raw) error("value: operator* / operator-> disagree with get()");
        return p->value;
    }

    // !*slots[s]
    bool isNull(int s) {
        const SP& p = held(s);
        Op op;
        bool null = !p;
        if (null != (p.get() == nullptr)) error("isNull: operator bool disagrees with get()");
        return null;
    }

    // slots[s]->use_count()
    int useCount(int s) {
        const SP& p = held(s);
        Op op;
        return static_cast<int>(p.use_count());
    }

    // number of Tracked objects currently alive
    int alive() { return static_cast<int>(st().live.size()); }

    // values of destroyed Tracked objects, in the order they were destroyed
    std::vector<int> destroyed() { return st().destroyed; }

    // heap blocks allocated by SharedPtr operations (control blocks) and not yet freed
    int heapBlocks() { return static_cast<int>(ipp_harness_sp::g_live.count); }

    // problems the harness detected (double delete, double free, ...); [] when all is well
    std::vector<std::string> errors() {
        ipp_harness_sp::Pause p;
        std::vector<std::string> e = st().errors;
        if (ipp_harness_sp::g_doubleFrees)
            e.push_back(std::to_string(ipp_harness_sp::g_doubleFrees) +
                        " heap block(s) freed twice (a control block deleted more than once?)");
        if (ipp_harness_sp::g_overflow) e.push_back("harness: too many heap allocations to track");
        return e;
    }
};
