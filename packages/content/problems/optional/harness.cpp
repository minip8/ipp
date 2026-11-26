// interview++ test harness for "optional". Appended after the candidate's code in judged runs.
//
// The tests drive OptionalHarness: four numbered slots, each either empty or holding one
// ::Optional<Tracked>. Every method performs one C++ operation or reports what happened.
// Tracked has no default constructor; every live Tracked is registered by address, and the
// operations performed on Tracked objects while the candidate's code runs (constructions,
// copies, moves, assignments, destructions) are recorded, so lifetime bugs (destroying an empty
// Optional, double destruction, assigning to raw storage, constructing over a live value,
// destroy-and-reconstruct where an assignment is required) show up as wrong values, in ops() or
// in errors().

#include <concepts>
#include <cstddef>
#include <cstdint>
#include <optional>
#include <stdexcept>
#include <string>
#include <type_traits>
#include <unordered_set>
#include <utility>
#include <vector>

namespace ipp_harness_opt {

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
    ~Op() { stop(); }
    void stop() { state().recording = false; }
    Op(const Op&) = delete;
    Op& operator=(const Op&) = delete;
};

/// Passed to emplace as an rvalue, to check perfect forwarding.
struct Label {};
/// Tracked(int, Boom) throws before the object exists.
struct Boom {};

/// The value type of every Optional in the tests: no default constructor, copyable, nothrow
/// movable. A moved-from Tracked has value -1.
struct Tracked {
    int value;

    Tracked() = delete;
    explicit Tracked(int v) : value(v) { born(kConstruct); }
    Tracked(int v, Label&&) : value(v) { born(kConstruct); }
    Tracked(int v, const Label&) : value(v) {
        born(kConstruct);
        state().error("emplace received an rvalue argument but passed it on as an lvalue: use std::forward");
    }
    Tracked(int, Boom) { throw std::runtime_error("Tracked(int, Boom) throws"); }

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
            state().error("a value was destroyed twice, or destroyed without having been constructed "
                          "(does the destructor or reset() destroy an empty Optional?)");
            return;
        }
        state().record(kDestroy);
    }

    static bool isLive(const void* p) { return state().live.count(p) != 0; }

private:
    void born(Kind k) {
        if (!state().live.insert(this).second)
            state().error("a value was constructed on top of a live value that was never destroyed");
        state().record(k);
    }
    void assignedTo() {
        if (!isLive(this)) {
            state().error("assigned to raw storage: when the target is empty the value must be constructed "
                          "(placement new), not assigned");
            state().live.insert(this);
        }
    }
    static int readFrom(const Tracked& o, const char* how) {
        if (isLive(&o)) return o.value;
        state().error(std::string("a value was ") + how +
                      " from an object that is not alive (already destroyed, or never constructed)");
        return -3;
    }
};

using O = ::Optional<Tracked>;

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
template <class X> concept HasObservers = requires(X& o, const X& co) {
    { co.has_value() } -> std::same_as<bool>;
    { o.value() } -> std::same_as<Tracked&>;
    { co.value() } -> std::same_as<const Tracked&>;
    { *o } -> std::same_as<Tracked&>;
    { *co } -> std::same_as<const Tracked&>;
    { o.operator->() } -> std::same_as<Tracked*>;
    { co.operator->() } -> std::same_as<const Tracked*>;
};
template <class X> concept HasEmplace = requires(X& o, int i) {
    { o.emplace(i) } -> std::same_as<Tracked&>;
    { o.emplace(i, Label{}) } -> std::same_as<Tracked&>;
};
template <class X> concept HasReset = requires(X& o) { o.reset(); };
template <class X> concept HasValueOr = requires(const X& o, int i) {
    { o.value_or(i) } -> std::same_as<Tracked>;
    { o.value_or(Tracked(i)) } -> std::same_as<Tracked>;
};

static_assert(!std::is_default_constructible_v<Tracked>, "harness self-check");
static_assert(std::is_nothrow_default_constructible_v<O>,
              "Optional<T>() must exist and be noexcept: it constructs no T (T may have no default constructor)");
static_assert(std::is_constructible_v<O, const Tracked&> && std::is_constructible_v<O, Tracked&&>,
              "Optional<T> needs constructors Optional(const T&) and Optional(T&&)");
static_assert(std::is_copy_constructible_v<O>, "Optional<T> needs a copy constructor");
static_assert(std::is_copy_assignable_v<O>, "Optional<T> needs a copy assignment operator");
static_assert(std::is_move_constructible_v<O> && std::is_move_assignable_v<O>,
              "Optional<T> needs a move constructor and a move assignment operator");
static_assert(std::is_nothrow_move_constructible_v<O> && !std::is_nothrow_move_constructible_v<::Optional<MayThrow>>,
              "Optional(Optional&&) must be noexcept exactly when T's move constructor is: "
              "noexcept(std::is_nothrow_move_constructible_v<T>)");
static_assert(std::is_nothrow_move_assignable_v<O> && !std::is_nothrow_move_assignable_v<::Optional<MayThrow>> &&
                  !std::is_nothrow_move_assignable_v<::Optional<AssignMayThrow>>,
              "Optional::operator=(Optional&&) must be noexcept exactly when T is nothrow move constructible "
              "and nothrow move assignable");
static_assert(std::is_constructible_v<bool, const O&> && !std::is_convertible_v<const O&, bool>,
              "Optional<T> needs `explicit operator bool() const` (explicit, so `int n = opt;` does not compile)");
static_assert(HasObservers<O>,
              "Optional<T> needs `bool has_value() const`, `T& value()`, `const T& value() const`, "
              "`T& operator*()`, `const T& operator*() const`, `T* operator->()` and `const T* operator->() const`");
static_assert(HasEmplace<O>,
              "Optional<T> needs `template <class... Args> T& emplace(Args&&... args)` returning the new value");
static_assert(HasReset<O>, "Optional<T> needs `void reset()`");
static_assert(HasValueOr<O>,
              "Optional<T> needs `template <class U> T value_or(U&& fallback) const`, converting the fallback "
              "with static_cast<T>(std::forward<U>(fallback)) only when empty");
static_assert(alignof(::Optional<Wide>) >= alignof(Wide),
              "the storage for the value must be aligned for T: use alignas(T) on a byte buffer, or a union member");
static_assert(sizeof(O) <= sizeof(Tracked) + alignof(Tracked) &&
                  sizeof(::Optional<Wide>) <= sizeof(Wide) + alignof(Wide),
              "the value must be stored inside the Optional (no heap allocation, no pointer): "
              "sizeof(Optional<T>) must be at most sizeof(T) + alignof(T)");

}  // namespace ipp_harness_opt

class OptionalHarness {
    using Tracked = ipp_harness_opt::Tracked;
    using O = ipp_harness_opt::O;
    using Op = ipp_harness_opt::Op;
    static constexpr int kSlots = 4;
    std::optional<O> slots_[kSlots];

    static ipp_harness_opt::State& st() { return ipp_harness_opt::state(); }

    std::optional<O>& slot(int s) {
        if (s < 0 || s >= kSlots) throw std::invalid_argument("test error: no slot " + std::to_string(s));
        return slots_[s];
    }
    O& held(int s) {
        auto& o = slot(s);
        if (!o) throw std::invalid_argument("test error: slot " + std::to_string(s) + " holds no Optional");
        return *o;
    }
    static bool engaged(const O& o) {
        bool h = o.has_value();
        if (static_cast<bool>(o) != h) st().error("operator bool disagrees with has_value()");
        return h;
    }
    static int read(const Tracked& t) {
        if (!Tracked::isLive(&t)) {
            st().error("the value read through the Optional is not alive (destroyed, or never constructed)");
            return -2;
        }
        return t.value;
    }
    // Every way of reaching the value must give the same object, inside the Optional itself.
    static void checkAccess(O& o) {
        const O& co = o;
        Tracked* p = &o.value();
        if (&co.value() != p || &*o != p || &*co != p || o.operator->() != p || co.operator->() != p)
            st().error("value(), operator* and operator-> (const and non-const) must all refer to the same object");
        auto a = reinterpret_cast<std::uintptr_t>(p), b = reinterpret_cast<std::uintptr_t>(&o);
        if (a < b || a + sizeof(Tracked) > b + sizeof(O))
            st().error("the value must be stored inside the Optional object, not on the heap");
        if (a % alignof(Tracked) != 0) st().error("the value is not suitably aligned for T");
    }

public:
    OptionalHarness() { st().clear(); }
    ~OptionalHarness() {
        Op op;
        for (auto& o : slots_) o.reset();
    }
    OptionalHarness(const OptionalHarness&) = delete;
    OptionalHarness& operator=(const OptionalHarness&) = delete;

    // slots[s].emplace()   (an existing Optional in the slot is destroyed first)
    void makeEmpty(int s) {
        auto& o = slot(s);
        Op op;
        o.emplace();
    }

    // Tracked t(value); slots[s].emplace(std::as_const(t));   -> Optional(const T&)
    void makeCopy(int s, int value) {
        auto& o = slot(s);
        Tracked t(value);
        Op op;
        o.emplace(std::as_const(t));
    }

    // Tracked t(value); slots[s].emplace(std::move(t));   -> Optional(T&&)
    void makeMove(int s, int value) {
        auto& o = slot(s);
        Tracked t(value);
        Op op;
        o.emplace(std::move(t));
    }

    // slots[s]->emplace(value, Label{}).value   (Label is an rvalue that must be forwarded)
    int emplace(int s, int value) {
        O& o = held(s);
        Tracked* r;
        {
            Op op;
            r = &o.emplace(value, ipp_harness_opt::Label{});
        }
        if (!engaged(o) || r != &*o) st().error("emplace must return a reference to the new value");
        return read(*r);
    }

    // slots[s]->emplace(value, Boom{}), whose Tracked constructor throws; returns whether the
    // exception reached the harness
    bool emplaceThrows(int s, int value) {
        O& o = held(s);
        try {
            Op op;
            o.emplace(value, ipp_harness_opt::Boom{});
        } catch (const std::runtime_error&) {
            return true;
        }
        return false;
    }

    // slots[s]->reset()
    void reset(int s) {
        O& o = held(s);
        Op op;
        o.reset();
    }

    // slots[s]->has_value()   (also checks operator bool)
    bool hasValue(int s) { return engaged(held(s)); }

    // slots[s]->value().value, or -4 if it throws std::bad_optional_access
    int value(int s) {
        O& o = held(s);
        Tracked* p;
        try {
            p = &o.value();
        } catch (const std::bad_optional_access&) {
            if (engaged(o)) st().error("value() threw std::bad_optional_access although has_value() is true");
            return -4;
        }
        if (!engaged(o)) st().error("value() did not throw std::bad_optional_access although has_value() is false");
        else checkAccess(o);
        return read(*p);
    }

    // slots[s]->value_or(fallback).value   (the result is a temporary the harness destroys)
    int valueOr(int s, int fallback) {
        const O& o = held(s);
        Op op;
        Tracked r = o.value_or(fallback);
        op.stop();
        return read(r);
    }

    // slots[to].emplace(*slots[from])   (from != to)
    void copyConstruct(int from, int to) {
        if (from == to) throw std::invalid_argument("test error: copyConstruct needs two slots");
        O& src = held(from);
        auto& dst = slot(to);
        Op op;
        dst.emplace(src);
    }

    // *slots[to] = *slots[from]   (from may equal to; self-assignment is not recorded in ops())
    void copyAssign(int from, int to) {
        O& src = held(from);
        O& dst = held(to);
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
        O& src = held(from);
        auto& dst = slot(to);
        Op op;
        dst.emplace(std::move(src));
    }

    // *slots[to] = std::move(*slots[from])   (from may equal to; self-assignment is not recorded)
    void moveAssign(int from, int to) {
        O& src = held(from);
        O& dst = held(to);
        if (from == to) {
            dst = std::move(src);
            return;
        }
        Op op;
        dst = std::move(src);
    }

    // destroys the Optional in slot s; the slot becomes empty
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

    // the Tracked operations performed by Optional code since the previous ops(), one entry per
    // operation, grouped in the order construct, copy-construct, move-construct, copy-assign,
    // move-assign, destroy
    std::vector<std::string> ops() {
        std::vector<std::string> out;
        for (int k = 0; k < ipp_harness_opt::kKinds; ++k) {
            for (long i = 0; i < st().counts[k]; ++i) out.push_back(ipp_harness_opt::kKindNames[k]);
            st().counts[k] = 0;
        }
        return out;
    }

    // problems the harness detected; [] when all is well
    std::vector<std::string> errors() { return st().errors; }
};
