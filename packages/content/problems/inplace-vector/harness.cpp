// interview++ test harness for "inplace-vector". Appended after the candidate's code in judged runs.
//
// The tests drive InplaceVectorHarness: four numbered slots, each either empty or holding one
// ::InplaceVector<Tracked, 6>. Every method performs one C++ operation or reports what happened.
// Tracked has no default constructor; every live Tracked is registered by address, and the
// operations performed on Tracked objects while the candidate's code runs are recorded, so
// lifetime bugs (default-constructed storage, assignment into raw storage, constructing over a
// live element, double destruction, leaks, destroy-and-reconstruct where an assignment is
// required, copying where a move is required) show up as wrong values, in ops() or in errors().

#include <concepts>
#include <cstddef>
#include <cstdint>
#include <new>
#include <optional>
#include <stdexcept>
#include <string>
#include <type_traits>
#include <unordered_set>
#include <utility>
#include <vector>

namespace ipp_harness_ivec {

enum Kind { kConstruct, kCopyConstruct, kMoveConstruct, kCopyAssign, kMoveAssign, kDestroy, kKinds };
inline const char* const kKindNames[kKinds] = {"construct",   "copy-construct", "move-construct",
                                               "copy-assign", "move-assign",    "destroy"};

struct State {
    std::unordered_set<const void*> live;  // addresses of live Tracked objects
    long counts[kKinds] = {};              // operations recorded since the last ops()
    bool recording = false;                // true while the candidate's code runs
    std::vector<std::string> errors;

    void clear() {
        live.clear();
        for (long& c : counts) c = 0;
        recording = false;
        errors.clear();
    }
    void error(const std::string& e) {
        for (auto& x : errors)
            if (x == e) return;
        if (errors.size() < 20) errors.push_back(e);
    }
    void record(Kind k) {
        if (recording) ++counts[k];
    }
};

inline State& state() {
    static State s;
    return s;
}

/// Records the Tracked operations performed in its scope (the candidate's code).
struct Op {
    Op() { state().recording = true; }
    ~Op() { state().recording = false; }
    Op(const Op&) = delete;
    Op& operator=(const Op&) = delete;
};
/// Suspends recording (for operations whose exact Tracked operations are not specified).
struct Unrecorded {
    bool was = state().recording;
    Unrecorded() { state().recording = false; }
    ~Unrecorded() { state().recording = was; }
    Unrecorded(const Unrecorded&) = delete;
    Unrecorded& operator=(const Unrecorded&) = delete;
};

/// Passed to emplace_back as an rvalue, to check perfect forwarding.
struct Label {};

/// The element type of every InplaceVector in the tests: no default constructor, copyable,
/// nothrow movable. A moved-from Tracked has value -1.
struct Tracked {
    int value;

    Tracked() = delete;
    explicit Tracked(int v) : value(v) { born(kConstruct); }
    Tracked(int v, Label&&) : value(v) { born(kConstruct); }
    Tracked(int v, const Label&) : value(v) {
        born(kConstruct);
        state().error("emplace_back received an rvalue argument but passed it on as an lvalue: use std::forward");
    }

    Tracked(const Tracked& o) : value(readFrom(o, "copied")) { born(kCopyConstruct); }
    Tracked(Tracked&& o) noexcept : value(readFrom(o, "moved")) {
        born(kMoveConstruct);
        if (isLive(&o)) o.value = -1;
    }
    Tracked& operator=(const Tracked& o) {
        assignedTo();
        value = readFrom(o, "copied");
        state().record(kCopyAssign);
        return *this;
    }
    Tracked& operator=(Tracked&& o) noexcept {
        assignedTo();
        int v = readFrom(o, "moved");
        if (isLive(&o)) o.value = -1;
        value = v;
        state().record(kMoveAssign);
        return *this;
    }

    ~Tracked() {
        if (!state().live.erase(this)) {
            state().error("an element was destroyed twice, or destroyed without having been constructed");
            return;
        }
        state().record(kDestroy);
    }

    static bool isLive(const void* p) { return state().live.count(p) != 0; }

private:
    void born(Kind k) {
        if (!state().live.insert(this).second)
            state().error("an element was constructed on top of a live element that was never destroyed");
        state().record(k);
    }
    void assignedTo() {
        if (!isLive(this)) {
            state().error("assigned to raw storage: a slot that holds no element must be constructed into "
                          "(placement new), not assigned");
            state().live.insert(this);
        }
    }
    static int readFrom(const Tracked& o, const char* how) {
        if (isLive(&o)) return o.value;
        state().error(std::string("an element was ") + how +
                      " from an object that is not alive (already destroyed, or never constructed)");
        return -3;
    }
};

inline constexpr std::size_t kN = 6;
using V = ::InplaceVector<Tracked, kN>;

/// Over-aligned, to check that the storage is aligned for T.
struct alignas(32) Wide {
    char c = 0;
};
/// Copyable and movable, but its move operations may throw.
struct MayThrow {
    MayThrow() = default;
    MayThrow(const MayThrow&) {}
    MayThrow(MayThrow&&) noexcept(false) {}
    MayThrow& operator=(const MayThrow&) { return *this; }
    MayThrow& operator=(MayThrow&&) noexcept(false) { return *this; }
};
/// Nothrow to move-construct, but its move assignment may throw.
struct AssignMayThrow {
    AssignMayThrow() = default;
    AssignMayThrow(const AssignMayThrow&) = default;
    AssignMayThrow(AssignMayThrow&&) noexcept {}
    AssignMayThrow& operator=(const AssignMayThrow&) = default;
    AssignMayThrow& operator=(AssignMayThrow&&) noexcept(false) { return *this; }
};

// ---- compile-time requirements (checked before any test runs) ----
template <class X> concept HasPush = requires(X& v, const Tracked& c, Tracked&& r) {
    v.push_back(c);
    v.push_back(static_cast<Tracked&&>(r));
    v.pop_back();
    { v.try_push_back(c) } -> std::same_as<Tracked*>;
    { v.try_push_back(static_cast<Tracked&&>(r)) } -> std::same_as<Tracked*>;
};
template <class X> concept HasEmplace = requires(X& v, int i) {
    { v.emplace_back(i) } -> std::same_as<Tracked&>;
    { v.emplace_back(i, Label{}) } -> std::same_as<Tracked&>;
};
template <class X> concept HasInsertErase = requires(X& v, const Tracked* p, const Tracked& c, Tracked&& r) {
    { v.insert(p, c) } -> std::same_as<Tracked*>;
    { v.insert(p, static_cast<Tracked&&>(r)) } -> std::same_as<Tracked*>;
    { v.erase(p) } -> std::same_as<Tracked*>;
    { v.erase(p, p) } -> std::same_as<Tracked*>;
};
template <class X> concept HasIndex = requires(X& v, const X& cv, std::size_t i) {
    { v[i] } -> std::same_as<Tracked&>;
    { cv[i] } -> std::same_as<const Tracked&>;
};
template <class X> concept HasSize = requires(X& v, const X& cv) {
    { cv.size() } -> std::same_as<std::size_t>;
    { cv.empty() } -> std::same_as<bool>;
    v.clear();
};
template <class X> concept HasIter = requires(X& v, const X& cv) {
    { v.begin() } -> std::same_as<Tracked*>;
    { v.end() } -> std::same_as<Tracked*>;
    { cv.begin() } -> std::same_as<const Tracked*>;
    { cv.end() } -> std::same_as<const Tracked*>;
};
template <class X> concept HasStaticCapacity = requires {
    { X::capacity() } -> std::same_as<std::size_t>;
    requires X::capacity() == kN;
};

static_assert(!std::is_default_constructible_v<Tracked>, "harness self-check");
static_assert(std::is_nothrow_default_constructible_v<V>,
              "InplaceVector<T, N>() must exist and be noexcept: it constructs no T (T may have no default constructor)");
static_assert(std::is_copy_constructible_v<V>, "InplaceVector<T, N> needs a copy constructor");
static_assert(std::is_copy_assignable_v<V>, "InplaceVector<T, N> needs a copy assignment operator");
static_assert(std::is_move_constructible_v<V> && std::is_move_assignable_v<V>,
              "InplaceVector<T, N> needs a move constructor and a move assignment operator");
static_assert(std::is_nothrow_move_constructible_v<V> &&
                  !std::is_nothrow_move_constructible_v<::InplaceVector<MayThrow, 2>>,
              "InplaceVector(InplaceVector&&) must be noexcept exactly when T's move constructor is: "
              "noexcept(std::is_nothrow_move_constructible_v<T>)");
static_assert(std::is_nothrow_move_assignable_v<V> && !std::is_nothrow_move_assignable_v<::InplaceVector<MayThrow, 2>> &&
                  !std::is_nothrow_move_assignable_v<::InplaceVector<AssignMayThrow, 2>>,
              "InplaceVector::operator=(InplaceVector&&) must be noexcept exactly when T is nothrow move "
              "constructible and nothrow move assignable");
static_assert(HasStaticCapacity<V>, "InplaceVector<T, N> needs `static constexpr std::size_t capacity() noexcept` returning N");
static_assert(HasPush<V>,
              "InplaceVector<T, N> needs push_back(const T&), push_back(T&&), pop_back(), and "
              "`T* try_push_back(const T&)` / `T* try_push_back(T&&)`");
static_assert(HasEmplace<V>,
              "InplaceVector<T, N> needs `template <class... Args> T& emplace_back(Args&&... args)` returning the new element");
static_assert(HasInsertErase<V>,
              "InplaceVector<T, N> needs `T* insert(const T* pos, const T&)`, `T* insert(const T* pos, T&&)`, "
              "`T* erase(const T* pos)` and `T* erase(const T* first, const T* last)`");
static_assert(HasIndex<V>, "InplaceVector<T, N> needs `T& operator[](std::size_t)` and `const T& operator[](std::size_t) const`");
static_assert(HasSize<V>, "InplaceVector<T, N> needs `std::size_t size() const`, `bool empty() const` and `void clear()`");
static_assert(HasIter<V>, "InplaceVector<T, N> needs `T* begin()`, `T* end()` and const overloads returning const T*");
static_assert(alignof(::InplaceVector<Wide, 3>) >= alignof(Wide),
              "the element storage must be aligned for T: use alignas(T) on a byte buffer, or a union member");
static_assert(sizeof(::InplaceVector<Wide, 3>) >= 3 * sizeof(Wide),
              "the elements must be stored inside the InplaceVector object (no heap allocation): "
              "sizeof(InplaceVector<T, N>) must be at least N * sizeof(T)");

}  // namespace ipp_harness_ivec

class InplaceVectorHarness {
    using Tracked = ipp_harness_ivec::Tracked;
    using V = ipp_harness_ivec::V;
    using Op = ipp_harness_ivec::Op;
    using Unrecorded = ipp_harness_ivec::Unrecorded;
    static constexpr int kSlots = 4;
    std::optional<V> slots_[kSlots];

    static ipp_harness_ivec::State& st() { return ipp_harness_ivec::state(); }

    std::optional<V>& slot(int s) {
        if (s < 0 || s >= kSlots) throw std::invalid_argument("test error: no slot " + std::to_string(s));
        return slots_[s];
    }
    V& held(int s) {
        auto& o = slot(s);
        if (!o) throw std::invalid_argument("test error: slot " + std::to_string(s) + " holds no InplaceVector");
        return *o;
    }
    static std::size_t sizeOf(const V& v) { return v.size(); }
    static int read(const Tracked& t) {
        if (!Tracked::isLive(&t)) {
            st().error("an element read through the InplaceVector is not alive (destroyed, or never constructed)");
            return -2;
        }
        return t.value;
    }
    static void checkIndex(const V& v, int i, bool allowEnd) {
        std::size_t n = sizeOf(v);
        if (i < 0 || std::size_t(i) > n || (!allowEnd && std::size_t(i) == n))
            throw std::logic_error("index " + std::to_string(i) + (allowEnd ? " is past" : " is not below") +
                                   " size() = " + std::to_string(n) +
                                   ": the tests only use valid positions, so size() looks wrong");
    }
    // Index of a returned pointer, or -9 (and an error) if it is not a position in v.
    static int indexOf(const V& v, const Tracked* p, const char* what) {
        const Tracked* b = v.begin();
        if (p < b || p > v.end()) {
            st().error(std::string(what) + " must return a pointer into the InplaceVector");
            return -9;
        }
        return static_cast<int>(p - b);
    }
    // Fullness is reported as -4 (std::bad_alloc); the vector must be unchanged.
    template <class F> int guardedInsert(V& v, F f, const char* what) {
        std::size_t before = sizeOf(v);
        try {
            const Tracked* r = f();
            return indexOf(v, r, what);
        } catch (const std::bad_alloc&) {
            if (before != ipp_harness_ivec::kN)
                st().error(std::string(what) + " threw std::bad_alloc although the InplaceVector was not full");
            if (sizeOf(v) != before) st().error(std::string(what) + " changed the size although it threw");
            return -4;
        }
    }

public:
    InplaceVectorHarness() { st().clear(); }
    ~InplaceVectorHarness() {
        Op op;
        for (auto& o : slots_) o.reset();
    }
    InplaceVectorHarness(const InplaceVectorHarness&) = delete;
    InplaceVectorHarness& operator=(const InplaceVectorHarness&) = delete;

    // slots[s].emplace()   (an existing InplaceVector in the slot is destroyed first)
    void create(int s) {
        auto& o = slot(s);
        Op op;
        o.emplace();
    }

    // Tracked t(value); slots[s]->push_back(std::as_const(t)); false if it threw std::bad_alloc
    bool pushCopy(int s, int value) {
        V& v = held(s);
        Tracked t(value);
        try {
            Op op;
            v.push_back(std::as_const(t));
        } catch (const std::bad_alloc&) {
            return false;
        }
        return true;
    }

    // Tracked t(value); slots[s]->push_back(std::move(t)); false if it threw std::bad_alloc
    bool pushMove(int s, int value) {
        V& v = held(s);
        Tracked t(value);
        try {
            Op op;
            v.push_back(std::move(t));
        } catch (const std::bad_alloc&) {
            if (t.value != value) st().error("push_back(T&&) moved from its argument although the InplaceVector was full");
            return false;
        }
        return true;
    }

    // slots[s]->emplace_back(value, Label{}).value, or -4 if it threw std::bad_alloc
    int emplace(int s, int value) {
        V& v = held(s);
        Tracked* r;
        try {
            Op op;
            r = &v.emplace_back(value, ipp_harness_ivec::Label{});
        } catch (const std::bad_alloc&) {
            return -4;
        }
        if (sizeOf(v) == 0 || r != &v[sizeOf(v) - 1]) st().error("emplace_back must return a reference to the new last element");
        return read(*r);
    }

    // Tracked t(value); slots[s]->try_push_back(std::as_const(t)) != nullptr
    bool tryPushCopy(int s, int value) {
        V& v = held(s);
        Tracked t(value);
        Tracked* r;
        {
            Op op;
            r = v.try_push_back(std::as_const(t));
        }
        if (r && r != &v[sizeOf(v) - 1]) st().error("try_push_back must return a pointer to the new last element");
        return r != nullptr;
    }

    // Tracked t(value); slots[s]->try_push_back(std::move(t)) != nullptr
    bool tryPushMove(int s, int value) {
        V& v = held(s);
        Tracked t(value);
        Tracked* r;
        {
            Op op;
            r = v.try_push_back(std::move(t));
        }
        if (r && r != &v[sizeOf(v) - 1]) st().error("try_push_back must return a pointer to the new last element");
        if (!r && t.value != value)
            st().error("try_push_back(T&&) moved from its argument although the InplaceVector was full");
        return r != nullptr;
    }

    // slots[s]->pop_back()
    void pop(int s) {
        V& v = held(s);
        if (sizeOf(v) == 0) throw std::logic_error("size() is 0 before a pop: the tests only pop non-empty vectors, so size() looks wrong");
        Op op;
        v.pop_back();
    }

    // Tracked t(value); index of slots[s]->insert(begin() + i, std::move(t)), or -4 if it threw std::bad_alloc
    int insertMove(int s, int i, int value) {
        V& v = held(s);
        checkIndex(v, i, true);
        Tracked t(value);
        const Tracked* pos = std::as_const(v).begin() + i;
        int r = guardedInsert(v, [&] { Op op; return v.insert(pos, std::move(t)); }, "insert(pos, T&&)");
        if (r == -4 && t.value != value) st().error("insert(pos, T&&) moved from its argument although the InplaceVector was full");
        return r;
    }

    // Tracked t(value); index of slots[s]->insert(begin() + i, std::as_const(t)), or -4 if it threw
    // std::bad_alloc   (its Tracked operations are not recorded in ops())
    int insertCopy(int s, int i, int value) {
        V& v = held(s);
        checkIndex(v, i, true);
        Tracked t(value);
        const Tracked* pos = std::as_const(v).begin() + i;
        return guardedInsert(v, [&] { Op op; Unrecorded u; return v.insert(pos, std::as_const(t)); }, "insert(pos, const T&)");
    }

    // index of slots[s]->insert(begin() + i, (*slots[s])[j]), or -4 if it threw std::bad_alloc
    // (the argument is an element of the same vector; not recorded in ops())
    int insertOwn(int s, int i, int j) {
        V& v = held(s);
        checkIndex(v, i, true);
        checkIndex(v, j, false);
        const Tracked* pos = std::as_const(v).begin() + i;
        const Tracked& x = std::as_const(v)[std::size_t(j)];
        return guardedInsert(v, [&] { Op op; Unrecorded u; return v.insert(pos, x); }, "insert(pos, const T&)");
    }

    // index of slots[s]->erase(begin() + i)
    int erase(int s, int i) {
        V& v = held(s);
        checkIndex(v, i, false);
        const Tracked* pos = std::as_const(v).begin() + i;
        Tracked* r;
        {
            Op op;
            r = v.erase(pos);
        }
        return indexOf(v, r, "erase");
    }

    // index of slots[s]->erase(begin() + i, begin() + j)   (i <= j)
    int eraseRange(int s, int i, int j) {
        V& v = held(s);
        checkIndex(v, i, true);
        checkIndex(v, j, true);
        if (i > j) throw std::invalid_argument("test error: eraseRange needs i <= j");
        const Tracked* first = std::as_const(v).begin() + i;
        const Tracked* last = std::as_const(v).begin() + j;
        Tracked* r;
        {
            Op op;
            r = v.erase(first, last);
        }
        return indexOf(v, r, "erase");
    }

    // (*slots[s])[i].value   (also compares the const operator[])
    int get(int s, int i) {
        V& v = held(s);
        checkIndex(v, i, false);
        Tracked* a = &v[std::size_t(i)];
        const Tracked* b = &std::as_const(v)[std::size_t(i)];
        if (a != b) st().error("operator[] and its const overload return different elements");
        return read(*a);
    }

    // slots[s]->size()   (also checks empty())
    int size(int s) {
        const V& v = held(s);
        std::size_t n = v.size();
        if (v.empty() != (n == 0)) st().error("empty() disagrees with size()");
        return static_cast<int>(n);
    }

    // slots[s]->clear()
    void clear(int s) {
        V& v = held(s);
        Op op;
        v.clear();
    }

    // the values of all elements, read with a range-for over the const vector (also checks
    // that they are stored inside the InplaceVector object)
    std::vector<int> contents(int s) {
        const V& v = held(s);
        std::size_t n = sizeOf(v);
        const Tracked* first = v.begin();
        const Tracked* last = v.end();
        if (std::size_t(last - first) != n) {
            st().error("end() - begin() is not size()");
            return {};
        }
        auto a = reinterpret_cast<std::uintptr_t>(first), b = reinterpret_cast<std::uintptr_t>(&v);
        if (a < b || a + ipp_harness_ivec::kN * sizeof(Tracked) > b + sizeof(V)) {
            st().error("the elements must be stored inside the InplaceVector object, not on the heap");
            return {};
        }
        std::vector<int> out;
        std::size_t k = 0;
        for (const Tracked* p = first; p != last; ++p, ++k) {
            if (&v[k] != p) st().error("begin()[i] and operator[](i) are different elements");
            out.push_back(read(*p));
        }
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

    // *slots[to] = *slots[from]   (from may equal to; self-assignment is not recorded in ops())
    void copyAssign(int from, int to) {
        V& src = held(from);
        V& dst = held(to);
        if (from == to) {
            dst = src;
            return;
        }
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

    // *slots[to] = std::move(*slots[from])   (from may equal to; self-assignment is not recorded)
    void moveAssign(int from, int to) {
        V& src = held(from);
        V& dst = held(to);
        if (from == to) {
            dst = std::move(src);
            return;
        }
        Op op;
        dst = std::move(src);
    }

    // destroys the InplaceVector in slot s; the slot becomes empty
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
    int alive() { return static_cast<int>(st().live.size()); }

    // the Tracked operations performed by InplaceVector code since the previous ops(), one entry
    // per operation, grouped in the order construct, copy-construct, move-construct, copy-assign,
    // move-assign, destroy
    std::vector<std::string> ops() {
        std::vector<std::string> out;
        for (int k = 0; k < ipp_harness_ivec::kKinds; ++k) {
            for (long i = 0; i < st().counts[k]; ++i) out.push_back(ipp_harness_ivec::kKindNames[k]);
            st().counts[k] = 0;
        }
        return out;
    }

    // problems the harness detected; [] when all is well
    std::vector<std::string> errors() { return st().errors; }
};
