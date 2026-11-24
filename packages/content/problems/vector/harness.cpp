// interview++ test harness for "vector". Appended after the candidate's code in judged runs.
//
// The tests drive VectorHarness: four numbered slots, each either empty or holding one
// ::Vector<Tracked>. Every method performs one C++ operation or reports what happened.
// Tracked has no default constructor; every live Tracked is registered by address, and copies,
// moves and assignments are counted, so element-lifetime bugs (default-constructed capacity,
// assignment into raw memory, double destruction, leaks, copying where a move is required)
// show up as wrong values or as entries in errors(). The global operator new/delete are
// replaced so the storage blocks the candidate allocates can be counted; freed blocks are
// quarantined until the next test, so a double free becomes a counted error.

#include <concepts>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <new>
#include <optional>
#include <stdexcept>
#include <string>
#include <type_traits>
#include <unordered_set>
#include <utility>
#include <vector>

namespace ipp_harness_vec {

// ---------------------------------------------------------------- heap accounting
// Blocks allocated with the global operator new while the candidate's code runs (inside an Op
// scope, outside a Pause scope) are "counted". Plain arrays and integers only: this runs inside
// operator new, before and after main.
struct PtrTable {
    static constexpr std::size_t kCap = std::size_t(1) << 16;  // power of two
    void* slots[kCap];
    std::size_t sizes[kCap];
    std::size_t used;   // live entries + tombstones
    std::size_t count;  // live entries

    static void* tomb() { return reinterpret_cast<void*>(std::uintptr_t(1)); }
    static std::size_t hash(void* p) {
        return std::size_t((std::uintptr_t(p) >> 4) * 0x9E3779B97F4A7C15ull) & (kCap - 1);
    }
    bool insert(void* p, std::size_t n) {
        if (used >= kCap / 4 * 3) return false;
        for (std::size_t i = hash(p);; i = (i + 1) & (kCap - 1)) {
            if (slots[i] == nullptr || slots[i] == tomb()) {
                if (slots[i] == nullptr) ++used;
                slots[i] = p;
                sizes[i] = n;
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
    static constexpr std::size_t kMissing = ~std::size_t(0);
    /// Removes p; returns its recorded size, or kMissing if p was not in the table.
    std::size_t erase(void* p) {
        std::size_t i = find(p);
        if (i == kCap) return kMissing;
        slots[i] = tomb();
        --count;
        return sizes[i];
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
inline std::size_t g_quarantineBytes = 0;
// No test needs more than a few MB of element storage; refusing huge requests keeps a runaway
// growth bug from exhausting the machine.
inline constexpr std::size_t kMaxBlock = std::size_t(64) << 20;

inline bool counting() { return g_counting && g_pause == 0; }

inline void* allocate(std::size_t n) {
    if (counting() && n > kMaxBlock) throw std::bad_alloc();
    void* p = std::malloc(n ? n : 1);
    if (!p) throw std::bad_alloc();
    if (counting() && !g_live.insert(p, n)) g_overflow = true;
    return p;
}

inline void deallocate(void* p) noexcept {
    if (!p) return;
    std::size_t n = g_live.erase(p);
    if (n != PtrTable::kMissing) {
        // Keep freed storage (so a double free or late access cannot corrupt the heap), up to a
        // budget so a reallocate-on-every-push bug cannot exhaust memory.
        if (g_quarantineBytes + n > (std::size_t(32) << 20) || !g_quarantine.insert(p, n)) {
            std::free(p);
        } else {
            g_quarantineBytes += n;
        }
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
    g_quarantineBytes = 0;
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

// ---------------------------------------------------------------- element lifetimes
struct State {
    std::unordered_set<const void*> live;  // addresses of live Tracked objects
    long copies = 0;                       // copy constructions + copy assignments
    long moves = 0;                        // move constructions + move assignments
    std::vector<std::string> errors;

    void clear() {
        live.clear();
        copies = moves = 0;
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

/// Passed to emplace_back as an rvalue, to check perfect forwarding.
struct Label {};

/// The element type of every Vector in the tests: no default constructor, copyable, nothrow
/// movable. A moved-from Tracked has value -1.
struct Tracked {
    int value;

    Tracked() = delete;
    explicit Tracked(int v) : value(v) { born(); }
    Tracked(int v, Label&&) : value(v) { born(); }
    Tracked(int v, const Label&) : value(v) {
        born();
        Pause p;
        state().error("emplace_back received an rvalue argument but passed it on as an lvalue: use std::forward");
    }

    Tracked(const Tracked& o) : value(readFrom(o, "copied")) {
        born();
        ++state().copies;
    }
    Tracked(Tracked&& o) noexcept : value(readFrom(o, "moved")) {
        born();
        ++state().moves;
        if (isLive(&o)) o.value = -1;
    }
    Tracked& operator=(const Tracked& o) {
        assignedTo();
        value = readFrom(o, "copied");
        ++state().copies;
        return *this;
    }
    Tracked& operator=(Tracked&& o) noexcept {
        assignedTo();
        int v = readFrom(o, "moved");
        if (isLive(&o)) o.value = -1;
        value = v;
        ++state().moves;
        return *this;
    }

    ~Tracked() {
        Pause p;
        if (!state().live.erase(this))
            state().error("an element was destroyed twice, or destroyed without having been constructed");
    }

    static bool isLive(const void* p) {
        Pause g;
        return state().live.count(p) != 0;
    }

private:
    void born() {
        Pause p;
        if (!state().live.insert(this).second)
            state().error("an element was constructed on top of a live element that was never destroyed");
    }
    void assignedTo() {
        if (!isLive(this)) {
            Pause p;
            state().error("assigned to raw memory: an element must be constructed (placement new) before it is assigned");
            state().live.insert(this);
        }
    }
    static int readFrom(const Tracked& o, const char* how) {
        if (isLive(&o)) return o.value;
        Pause p;
        state().error(std::string("an element was ") + how +
                      " from an object that is not alive (already destroyed, or never constructed)");
        return -3;
    }
};

using V = ::Vector<Tracked>;

// ---- compile-time requirements (checked before any test runs) ----
template <class X> concept HasPush = requires(X& v, const Tracked& c, Tracked&& r) {
    v.push_back(c);
    v.push_back(static_cast<Tracked&&>(r));
    v.pop_back();
};
template <class X> concept HasEmplace = requires(X& v, int i) {
    { v.emplace_back(i) } -> std::same_as<Tracked&>;
    { v.emplace_back(i, Label{}) } -> std::same_as<Tracked&>;
};
template <class X> concept HasIndex = requires(X& v, const X& cv, std::size_t i) {
    { v[i] } -> std::same_as<Tracked&>;
    { cv[i] } -> std::same_as<const Tracked&>;
    { v.at(i) } -> std::same_as<Tracked&>;
    { cv.at(i) } -> std::same_as<const Tracked&>;
};
template <class X> concept HasSize = requires(X& v, const X& cv, std::size_t n) {
    { cv.size() } -> std::same_as<std::size_t>;
    { cv.capacity() } -> std::same_as<std::size_t>;
    { cv.empty() } -> std::same_as<bool>;
    v.reserve(n);
    v.clear();
};
template <class X> concept HasIter = requires(X& v, const X& cv) {
    { v.begin() } -> std::same_as<Tracked*>;
    { v.end() } -> std::same_as<Tracked*>;
    { cv.begin() } -> std::same_as<const Tracked*>;
    { cv.end() } -> std::same_as<const Tracked*>;
};

static_assert(!std::is_default_constructible_v<Tracked>, "harness self-check");
static_assert(std::is_nothrow_default_constructible_v<V>,
              "Vector<T>() must exist and be noexcept (an empty vector allocates nothing)");
static_assert(std::is_copy_constructible_v<V>, "Vector<T> needs a copy constructor");
static_assert(std::is_copy_assignable_v<V>, "Vector<T> needs a copy assignment operator");
static_assert(std::is_nothrow_move_constructible_v<V>, "Vector(Vector&&) must exist and be noexcept");
static_assert(std::is_nothrow_move_assignable_v<V>, "Vector::operator=(Vector&&) must exist and be noexcept");
static_assert(HasPush<V>, "Vector<T> needs push_back(const T&), push_back(T&&) and pop_back()");
static_assert(HasEmplace<V>,
              "Vector<T> needs `template <class... Args> T& emplace_back(Args&&... args)` returning the new element");
static_assert(HasIndex<V>,
              "Vector<T> needs `T& operator[](std::size_t)`, `T& at(std::size_t)` and their const overloads returning const T&");
static_assert(HasSize<V>,
              "Vector<T> needs `std::size_t size() const`, `std::size_t capacity() const`, `bool empty() const`, "
              "`void reserve(std::size_t)` and `void clear()`");
static_assert(HasIter<V>, "Vector<T> needs `T* begin()`, `T* end()` and const overloads returning const T*");

}  // namespace ipp_harness_vec

// Replacements for the global allocation functions (counted while the candidate's code runs).
void* operator new(std::size_t n) { return ipp_harness_vec::allocate(n); }
void* operator new[](std::size_t n) { return ipp_harness_vec::allocate(n); }
void* operator new(std::size_t n, const std::nothrow_t&) noexcept {
    try {
        return ipp_harness_vec::allocate(n);
    } catch (...) {
        return nullptr;
    }
}
void* operator new[](std::size_t n, const std::nothrow_t&) noexcept {
    try {
        return ipp_harness_vec::allocate(n);
    } catch (...) {
        return nullptr;
    }
}
void operator delete(void* p) noexcept { ipp_harness_vec::deallocate(p); }
void operator delete[](void* p) noexcept { ipp_harness_vec::deallocate(p); }
void operator delete(void* p, std::size_t) noexcept { ipp_harness_vec::deallocate(p); }
void operator delete[](void* p, std::size_t) noexcept { ipp_harness_vec::deallocate(p); }
void operator delete(void* p, const std::nothrow_t&) noexcept { ipp_harness_vec::deallocate(p); }
void operator delete[](void* p, const std::nothrow_t&) noexcept { ipp_harness_vec::deallocate(p); }

class VectorHarness {
    using Tracked = ipp_harness_vec::Tracked;
    using V = ipp_harness_vec::V;
    using Op = ipp_harness_vec::Op;
    static constexpr int kSlots = 4;
    std::optional<V> slots_[kSlots];

    static ipp_harness_vec::State& st() { return ipp_harness_vec::state(); }
    static void error(const std::string& e) {
        ipp_harness_vec::Pause p;
        st().error(e);
    }

    std::optional<V>& slot(int s) {
        if (s < 0 || s >= kSlots) throw std::invalid_argument("test error: no slot " + std::to_string(s));
        return slots_[s];
    }
    V& held(int s) {
        auto& o = slot(s);
        if (!o) throw std::invalid_argument("test error: slot " + std::to_string(s) + " holds no Vector");
        return *o;
    }
    static std::size_t sizeOf(const V& v) {
        Op op;
        return v.size();
    }
    static int read(const Tracked& t) {
        if (!Tracked::isLive(&t)) {
            error("an element read through the Vector is not alive (destroyed, or never constructed)");
            return -2;
        }
        return t.value;
    }

public:
    VectorHarness() {
        {
            ipp_harness_vec::Pause p;
            st().clear();
        }
        ipp_harness_vec::resetHeap();
    }
    ~VectorHarness() {
        Op op;
        for (auto& o : slots_) o.reset();
    }
    VectorHarness(const VectorHarness&) = delete;
    VectorHarness& operator=(const VectorHarness&) = delete;

    // slots[s].emplace()   (an existing Vector in the slot is destroyed first)
    void create(int s) {
        auto& o = slot(s);
        Op op;
        o.emplace();
    }

    // Tracked t(value); slots[s]->push_back(t);
    void pushCopy(int s, int value) {
        V& v = held(s);
        Tracked t(value);
        Op op;
        v.push_back(std::as_const(t));
    }

    // Tracked t(value); slots[s]->push_back(std::move(t));
    void pushMove(int s, int value) {
        V& v = held(s);
        Tracked t(value);
        Op op;
        v.push_back(std::move(t));
    }

    // slots[s]->emplace_back(value, Label{}).value   (Label is an rvalue that must be forwarded)
    int emplace(int s, int value) {
        V& v = held(s);
        Tracked* r;
        Tracked* last;
        {
            Op op;
            r = &v.emplace_back(value, ipp_harness_vec::Label{});
            last = v.size() ? &v[v.size() - 1] : nullptr;
        }
        if (r != last) error("emplace_back must return a reference to the new last element");
        return read(*r);
    }

    // slots[s]->push_back((*slots[s])[i])   (the argument is an element of the same vector)
    void pushOwn(int s, int i) {
        V& v = held(s);
        if (i < 0 || std::size_t(i) >= sizeOf(v)) throw std::logic_error("index " + std::to_string(i) + " is not below size() = " + std::to_string(sizeOf(v)) + ": the tests only use valid indices, so size() looks wrong");
        Op op;
        v.push_back(v[std::size_t(i)]);
    }

    // slots[s]->pop_back()
    void pop(int s) {
        V& v = held(s);
        if (sizeOf(v) == 0) throw std::logic_error("size() is 0 before a pop: the tests only pop non-empty vectors, so size() looks wrong");
        Op op;
        v.pop_back();
    }

    // (*slots[s])[i].value   (also compares the const operator[])
    int get(int s, int i) {
        V& v = held(s);
        if (i < 0 || std::size_t(i) >= sizeOf(v)) throw std::logic_error("index " + std::to_string(i) + " is not below size() = " + std::to_string(sizeOf(v)) + ": the tests only use valid indices, so size() looks wrong");
        Tracked* a;
        const Tracked* b;
        {
            Op op;
            a = &v[std::size_t(i)];
            b = &std::as_const(v)[std::size_t(i)];
        }
        if (a != b) error("operator[] and its const overload return different elements");
        return read(*a);
    }

    // slots[s]->at(i).value, or -1 if at throws std::out_of_range (i may be negative: it is
    // converted to std::size_t, giving a huge index)
    int at(int s, int i) {
        const V& v = held(s);
        const Tracked* r;
        try {
            Op op;
            r = &v.at(static_cast<std::size_t>(i));
        } catch (const std::out_of_range&) {
            return -1;
        }
        return read(*r);
    }

    // slots[s]->size()   (also checks empty())
    int size(int s) {
        const V& v = held(s);
        Op op;
        std::size_t n = v.size();
        if (v.empty() != (n == 0)) error("empty() disagrees with size()");
        return static_cast<int>(n);
    }

    // slots[s]->capacity()
    int capacity(int s) {
        const V& v = held(s);
        Op op;
        return static_cast<int>(v.capacity());
    }

    // slots[s]->reserve(n)
    void reserve(int s, int n) {
        V& v = held(s);
        Op op;
        v.reserve(static_cast<std::size_t>(n));
    }

    // slots[s]->clear()
    void clear(int s) {
        V& v = held(s);
        Op op;
        v.clear();
    }

    // the values of all elements, read with a range-for over the const vector
    std::vector<int> contents(int s) {
        const V& v = held(s);
        std::vector<int> out;
        std::size_t n = sizeOf(v);
        {
            ipp_harness_vec::Pause p;
            out.reserve(n);
        }
        const Tracked* first;
        const Tracked* last;
        {
            Op op;
            first = v.begin();
            last = v.end();
        }
        if (std::size_t(last - first) != n) {
            error("end() - begin() is not size()");
            return {};
        }
        std::size_t k = 0;
        for (const Tracked* p = first; p != last; ++p, ++k) {
            const Tracked* q;
            {
                Op op;
                q = &v[k];
            }
            if (q != p) error("begin()[i] and operator[](i) are different elements");
            int x = read(*p);
            ipp_harness_vec::Pause g;
            out.push_back(x);
        }
        ipp_harness_vec::Pause g;
        return out;
    }

    // slots[to].emplace(*slots[from])   (from != to)
    void copyConstruct(int from, int to) {
        if (from == to) throw std::invalid_argument("test error: copyConstruct needs two slots");
        V& src = held(from);
        auto& dst = slot(to);
        Op op;
        dst.emplace(src);
    }

    // *slots[to] = *slots[from]   (from may equal to)
    void copyAssign(int from, int to) {
        V& src = held(from);
        V& dst = held(to);
        Op op;
        dst = src;
    }

    // slots[to].emplace(std::move(*slots[from]))   (from != to)
    void moveConstruct(int from, int to) {
        if (from == to) throw std::invalid_argument("test error: moveConstruct needs two slots");
        V& src = held(from);
        auto& dst = slot(to);
        Op op;
        dst.emplace(std::move(src));
    }

    // *slots[to] = std::move(*slots[from])   (from may equal to)
    void moveAssign(int from, int to) {
        V& src = held(from);
        V& dst = held(to);
        Op op;
        dst = std::move(src);
    }

    // destroys the Vector in slot s; the slot becomes empty
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

    // number of Tracked objects currently alive
    int alive() {
        ipp_harness_vec::Pause p;
        return static_cast<int>(st().live.size());
    }

    // Tracked copy constructions + copy assignments so far in this test
    int copies() { return static_cast<int>(st().copies); }

    // Tracked move constructions + move assignments so far in this test
    int moves() { return static_cast<int>(st().moves); }

    // heap blocks allocated by Vector operations and not yet freed
    int heapBlocks() { return static_cast<int>(ipp_harness_vec::g_live.count); }

    // problems the harness detected; [] when all is well
    std::vector<std::string> errors() {
        ipp_harness_vec::Pause p;
        std::vector<std::string> e = st().errors;
        if (ipp_harness_vec::g_doubleFrees)
            e.push_back(std::to_string(ipp_harness_vec::g_doubleFrees) + " storage block(s) freed twice");
        if (ipp_harness_vec::g_overflow) e.push_back("harness: too many heap allocations to track");
        return e;
    }
};
