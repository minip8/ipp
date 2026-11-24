// interview++ test harness for "unique-ptr". Appended after the candidate's code in judged runs.
//
// The tests drive UniquePtrHarness: eight numbered slots, each either empty or holding one
// ::UniquePtr<Tracked>. Every method performs one C++ operation on the slots or reports what
// happened. Tracked objects record their own lifetimes in harness state, so ownership bugs
// (double delete, leak, use after move, release that deletes, reset in the wrong order) show
// up as wrong values or as entries in errors() rather than as undefined behaviour.

#include <concepts>
#include <cstddef>
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

namespace ipp_harness_up {

/// Passed through makeUnique to check perfect forwarding.
struct Label {};

struct State {
    std::unordered_map<const void*, int> live;  // live Tracked objects -> value
    std::unordered_set<void*> allocated;        // blocks from Tracked::operator new, not yet deleted
    std::unordered_set<void*> quarantine;       // deleted blocks: kept until the next test so a
                                                // double delete never touches freed memory
    std::vector<int> destroyed;                 // values, in destruction order
    std::vector<std::string> errors;
    // While reset() runs: reads the stored pointer of the UniquePtr being reset.
    const void* (*peek)(const void*) = nullptr;
    const void* peekArg = nullptr;

    void clear() {
        for (void* p : quarantine) std::free(p);
        for (void* p : allocated) std::free(p);  // leaked by the previous test
        live.clear();
        allocated.clear();
        quarantine.clear();
        destroyed.clear();
        errors.clear();
        peek = nullptr;
        peekArg = nullptr;
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

/// The element type the tests use. Not copyable or movable: only pointers to it move around.
struct Tracked {
    int value;
    bool forwardedRvalue = false;

    explicit Tracked(int v) : value(v) { born(); }
    Tracked(int v, Label&&) : value(v), forwardedRvalue(true) { born(); }
    Tracked(int v, const Label&) : value(v), forwardedRvalue(false) { born(); }
    Tracked(const Tracked&) = delete;
    Tracked& operator=(const Tracked&) = delete;

    ~Tracked() {
        State& s = state();
        auto it = s.live.find(this);
        if (it == s.live.end()) {
            s.error("an object was destroyed twice (double delete)");
            return;
        }
        int v = it->second;
        s.live.erase(it);
        s.destroyed.push_back(v);
        if (s.peek && s.peek(s.peekArg) == this)
            s.error("reset() deleted the old object (value " + std::to_string(v) +
                    ") while the UniquePtr still pointed to it: store the new pointer first, then delete the old one");
    }

    static void* operator new(std::size_t n) {
        void* p = std::malloc(n ? n : 1);
        if (!p) throw std::bad_alloc();
        state().allocated.insert(p);
        return p;
    }
    static void operator delete(void* p) noexcept {
        if (!p) return;
        State& s = state();
        if (s.allocated.erase(p)) {
            s.quarantine.insert(p);
        } else if (!s.quarantine.count(p)) {
            ::operator delete(p);  // came from ::new T(...); not ours to track
        }
        // else: second delete of the same block, already reported by ~Tracked
    }

private:
    void born() {
        State& s = state();
        if (s.live.count(this)) s.error("an object was constructed on top of a live object");
        s.live[this] = value;
    }
};

using UP = ::UniquePtr<Tracked>;

/// Never callable with real arguments; it only makes `::makeUnique` name something, so a missing
/// makeUnique is reported by the static_assert below instead of a lookup error.
struct NoMakeUnique {};

}  // namespace ipp_harness_up

template <class T, class... Args>
void makeUnique(ipp_harness_up::NoMakeUnique, ipp_harness_up::NoMakeUnique, Args&&...) = delete;

namespace ipp_harness_up {

// ---- compile-time requirements (checked before any test runs) ----
template <class P> concept HasGet = requires(const P& p) { { p.get() } -> std::same_as<Tracked*>; };
template <class P> concept HasDeref = requires(const P& p) {
    { *p } -> std::same_as<Tracked&>;
    { p.operator->() } -> std::same_as<Tracked*>;
};
template <class P> concept HasRelease = requires(P& p) { { p.release() } -> std::same_as<Tracked*>; };
template <class P> concept HasReset = requires(P& p, Tracked* raw) {
    p.reset(raw);
    p.reset();
};
template <class P> concept HasSwap = requires(P& a, P& b) { a.swap(b); };
template <class T> concept HasMakeUnique = requires(int v, Label& l) {
    { ::makeUnique<T>(v) } -> std::same_as<::UniquePtr<T>>;
    { ::makeUnique<T>(v, Label{}) } -> std::same_as<::UniquePtr<T>>;
    { ::makeUnique<T>(v, l) } -> std::same_as<::UniquePtr<T>>;
};

static_assert(std::is_nothrow_default_constructible_v<UP>,
              "UniquePtr<T>() must exist and be noexcept: it creates an empty (null) UniquePtr");
static_assert(std::is_constructible_v<UP, Tracked*>,
              "UniquePtr<T> needs a constructor UniquePtr(T* p) that takes ownership of p");
static_assert(!std::is_convertible_v<Tracked*, UP>,
              "UniquePtr(T* p) must be explicit, so a raw pointer never becomes owned by accident");
static_assert(!std::is_copy_constructible_v<UP>,
              "UniquePtr<T> must not be copy constructible: two owners would both delete the object");
static_assert(!std::is_copy_assignable_v<UP>,
              "UniquePtr<T> must not be copy assignable: two owners would both delete the object");
static_assert(std::is_move_constructible_v<UP> && std::is_move_assignable_v<UP>,
              "UniquePtr<T> needs a move constructor and a move assignment operator");
static_assert(std::is_nothrow_move_constructible_v<UP>, "UniquePtr(UniquePtr&&) must be noexcept");
static_assert(std::is_nothrow_move_assignable_v<UP>, "UniquePtr::operator=(UniquePtr&&) must be noexcept");
static_assert(std::is_constructible_v<bool, const UP&> && !std::is_convertible_v<const UP&, bool>,
              "UniquePtr<T> needs `explicit operator bool() const` (explicit, so `int n = p;` does not compile)");
static_assert(HasGet<UP>, "UniquePtr<T> needs `T* get() const`");
static_assert(HasDeref<UP>, "UniquePtr<T> needs `T& operator*() const` and `T* operator->() const`");
static_assert(HasRelease<UP>, "UniquePtr<T> needs `T* release()`");
static_assert(HasReset<UP>, "UniquePtr<T> needs `void reset(T* p = nullptr)`");
static_assert(HasSwap<UP>, "UniquePtr<T> needs `void swap(UniquePtr& other)`");
static_assert(HasMakeUnique<Tracked>,
              "needs a free function template `template <class T, class... Args> UniquePtr<T> makeUnique(Args&&... args)`");
static_assert(sizeof(UP) == sizeof(Tracked*),
              "a UniquePtr<T> must be exactly the size of a T*: it stores the pointer and nothing else");

inline const void* peekStored(const void* p) { return static_cast<const UP*>(p)->get(); }

}  // namespace ipp_harness_up

class UniquePtrHarness {
    using Tracked = ipp_harness_up::Tracked;
    using UP = ipp_harness_up::UP;
    static constexpr int kSlots = 8;
    std::optional<UP> slots_[kSlots];

    static ipp_harness_up::State& st() { return ipp_harness_up::state(); }

    std::optional<UP>& slot(int s) {
        if (s < 0 || s >= kSlots) throw std::invalid_argument("test error: no slot " + std::to_string(s));
        return slots_[s];
    }
    UP& held(int s) {
        auto& o = slot(s);
        if (!o) throw std::invalid_argument("test error: slot " + std::to_string(s) + " holds no UniquePtr");
        return *o;
    }
    // Reads the pointee of a UniquePtr without ever touching a destroyed object.
    int read(const UP& p, const char* what) {
        Tracked* raw = p.get();
        bool nonNull = static_cast<bool>(p);
        if (nonNull != (raw != nullptr)) st().error(std::string(what) + ": operator bool disagrees with get()");
        if (!raw) return -1;
        auto it = st().live.find(raw);
        if (it == st().live.end()) {
            st().error(std::string(what) + ": the UniquePtr points to an object that was already deleted");
            return -2;
        }
        if (&*p != raw || p.operator->() != raw)
            st().error(std::string(what) + ": operator* / operator-> disagree with get()");
        return p->value;
    }

public:
    UniquePtrHarness() { st().clear(); }
    UniquePtrHarness(const UniquePtrHarness&) = delete;
    UniquePtrHarness& operator=(const UniquePtrHarness&) = delete;

    // slots[s].emplace(new Tracked(value))   (an existing UniquePtr in the slot is destroyed first)
    void make(int s, int value) { slot(s).emplace(new Tracked(value)); }

    // slots[s].emplace()   (a default-constructed, null UniquePtr)
    void makeNull(int s) { slot(s).emplace(); }

    // slots[s].emplace(makeUnique<Tracked>(value, label)), passing label as an rvalue or an lvalue.
    // Returns whether Tracked's constructor received the label as an rvalue.
    bool makeUnique(int s, int value, bool rvalue) {
        ipp_harness_up::Label label;
        if (rvalue) slot(s).emplace(::makeUnique<Tracked>(value, std::move(label)));
        else slot(s).emplace(::makeUnique<Tracked>(value, label));
        Tracked* raw = held(s).get();
        if (!raw || !st().live.count(raw)) {
            st().error("makeUnique did not return a UniquePtr owning a live object");
            return false;
        }
        return raw->forwardedRvalue;
    }

    // slots[to].emplace(std::move(*slots[from]))   (from != to)
    void moveConstruct(int from, int to) {
        if (from == to) throw std::invalid_argument("test error: moveConstruct needs two slots");
        UP& src = held(from);
        slot(to).emplace(std::move(src));
    }

    // *slots[to] = std::move(*slots[from])   (from may equal to: self-move-assignment)
    void moveAssign(int from, int to) {
        UP& src = held(from);
        UP& dst = held(to);
        dst = std::move(src);
    }

    // Tracked* raw = slots[s]->release(); returns raw->value (-1 if raw is null), then deletes raw.
    int release(int s) {
        UP& p = held(s);
        Tracked* raw = p.release();
        if (p.get() != nullptr) st().error("release() must leave the UniquePtr null");
        if (!raw) return -1;
        auto it = st().live.find(raw);
        if (it == st().live.end()) {
            st().error("release() deleted the object it returned: release must give up ownership without deleting");
            return -2;
        }
        int v = it->second;
        delete raw;
        return v;
    }

    // slots[s]->reset(new Tracked(value))
    void reset(int s, int value) {
        UP& p = held(s);
        Tracked* fresh = new Tracked(value);
        st().peek = &ipp_harness_up::peekStored;
        st().peekArg = &p;
        p.reset(fresh);
        st().peek = nullptr;
        st().peekArg = nullptr;
    }

    // slots[s]->reset()
    void resetNull(int s) {
        UP& p = held(s);
        st().peek = &ipp_harness_up::peekStored;
        st().peekArg = &p;
        p.reset();
        st().peek = nullptr;
        st().peekArg = nullptr;
    }

    // slots[a]->swap(*slots[b])   (a may equal b)
    void swap(int a, int b) {
        UP& x = held(a);
        UP& y = held(b);
        x.swap(y);
    }

    // slots[s].reset(): the UniquePtr's destructor runs (it goes out of scope)
    void destroy(int s) {
        held(s);
        slot(s).reset();
    }

    // destroy every non-empty slot, in slot order
    void destroyAll() {
        for (auto& o : slots_) o.reset();
    }

    // slots[s]->value read through operator->, or -1 if the UniquePtr is null
    int value(int s) { return read(std::as_const(held(s)), "value"); }

    // !*slots[s]   (uses explicit operator bool)
    bool isNull(int s) {
        const UP& p = held(s);
        bool null = !p;
        if (null != (p.get() == nullptr)) st().error("isNull: operator bool disagrees with get()");
        return null;
    }

    // number of Tracked objects currently alive
    int alive() { return static_cast<int>(st().live.size()); }

    // values of destroyed Tracked objects, in the order they were destroyed
    std::vector<int> destroyed() { return st().destroyed; }

    // problems the harness detected (double delete, reset order, ...); [] when all is well
    std::vector<std::string> errors() { return st().errors; }
};
