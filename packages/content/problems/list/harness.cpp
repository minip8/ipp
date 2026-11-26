// interview++ test harness for "list". Appended after the candidate's code in judged runs.
//
// The tests drive ListHarness: four numbered list slots, each either empty or holding one
// ::List<Tracked>, and eight iterator slots, each either empty or holding one
// List<Tracked>::iterator. Every method performs one C++ operation or reports what happened.
// Tracked has no default constructor; every live Tracked is registered by address, and copies
// and moves are counted, so node-ownership bugs (an element copied by splice or by a list move,
// destroyed twice or never, an iterator left dangling by an operation that must keep it valid)
// show up as wrong values or as entries in errors(). Walks over a list are bounded by size(), so
// a broken link reports an error instead of looping forever. The global operator new/delete are
// replaced so the nodes the candidate allocates can be counted; freed blocks are quarantined
// until the next test, so a double free becomes a counted error.

#include <concepts>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <iterator>
#include <new>
#include <optional>
#include <ranges>
#include <stdexcept>
#include <string>
#include <type_traits>
#include <unordered_set>
#include <utility>
#include <vector>

namespace ipp_harness_list {

// ---------------------------------------------------------------- heap accounting
// Blocks allocated with the global operator new while the candidate's code runs (inside an Op
// scope, outside a Pause scope) are "counted". Plain arrays and integers only: this runs inside
// operator new, before and after main.
struct PtrTable {
    static constexpr std::size_t kCap = std::size_t(1) << 16;  // power of two
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
// A node needs a few dozen bytes; refusing huge requests keeps a runaway bug contained.
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
        // Keep freed nodes until the next test, so a double free or a walk through a freed node
        // cannot corrupt the heap.
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

inline void error(const std::string& e) {
    Pause p;
    state().error(e);
}

inline bool isLive(const void* p) {
    Pause g;
    return state().live.count(p) != 0;
}

/// Passed to emplace as an rvalue, to check perfect forwarding.
struct Label {};

/// The element type of every List in the tests: no default constructor, copyable, nothrow
/// movable. A moved-from Tracked has value -1.
struct Tracked {
    int value;

    Tracked() = delete;
    explicit Tracked(int v) : value(v) { born(); }
    Tracked(int v, Label&&) : value(v) { born(); }
    Tracked(int v, const Label&) : value(v) {
        born();
        error("emplace received an rvalue argument but passed it on as an lvalue: use std::forward");
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

private:
    void born() {
        Pause p;
        if (!state().live.insert(this).second)
            state().error("an element was constructed on top of a live element that was never destroyed");
    }
    void assignedTo() {
        if (!isLive(this)) error("assigned to an element that is not alive");
    }
    static int readFrom(const Tracked& o, const char* how) {
        if (isLive(&o)) return o.value;
        error(std::string("an element was ") + how + " from an object that is not alive (already destroyed)");
        return -3;
    }
};

using L = ::List<Tracked>;

// ---- compile-time requirements (checked before any test runs) ----
template <class X> concept HasIterTypes = requires {
    typename X::iterator;
    typename X::const_iterator;
};
template <class X> concept HasBeginEnd = requires(X& l, const X& cl) {
    { l.begin() } -> std::same_as<typename X::iterator>;
    { l.end() } -> std::same_as<typename X::iterator>;
    { cl.begin() } -> std::same_as<typename X::const_iterator>;
    { cl.end() } -> std::same_as<typename X::const_iterator>;
};
template <class X> concept HasArrow = requires(const typename X::iterator i, const typename X::const_iterator ci) {
    { i.operator->() } -> std::same_as<Tracked*>;
    { ci.operator->() } -> std::same_as<const Tracked*>;
};
template <class X> concept HasAccess = requires(X& l, const X& cl) {
    { cl.size() } -> std::same_as<std::size_t>;
    { cl.empty() } -> std::same_as<bool>;
    { l.front() } -> std::same_as<Tracked&>;
    { l.back() } -> std::same_as<Tracked&>;
    { cl.front() } -> std::same_as<const Tracked&>;
    { cl.back() } -> std::same_as<const Tracked&>;
};
template <class X> concept HasModifiers =
    requires(X& l, X& o, typename X::const_iterator p, const Tracked& c, Tracked&& r, int v) {
        l.push_back(c);
        l.push_back(static_cast<Tracked&&>(r));
        l.push_front(c);
        l.push_front(static_cast<Tracked&&>(r));
        l.pop_back();
        l.pop_front();
        { l.insert(p, c) } -> std::same_as<typename X::iterator>;
        { l.insert(p, static_cast<Tracked&&>(r)) } -> std::same_as<typename X::iterator>;
        { l.emplace(p, v, Label{}) } -> std::same_as<typename X::iterator>;
        { l.erase(p) } -> std::same_as<typename X::iterator>;
        l.clear();
        l.splice(p, o);
        l.splice(p, o, p);
        l.reverse();
    };

static_assert(!std::is_default_constructible_v<Tracked>, "harness self-check");
static_assert(HasIterTypes<L>, "List<T> needs member types `iterator` and `const_iterator`");
static_assert(std::is_nothrow_default_constructible_v<L>,
              "List<T>() must exist and be noexcept (the sentinel is a member: an empty list allocates nothing)");
static_assert(std::is_copy_constructible_v<L>, "List<T> needs a copy constructor");
static_assert(std::is_copy_assignable_v<L>, "List<T> needs a copy assignment operator");
static_assert(std::is_nothrow_move_constructible_v<L>, "List(List&&) must exist and be noexcept");
static_assert(std::is_nothrow_move_assignable_v<L>, "List::operator=(List&&) must exist and be noexcept");
static_assert(HasBeginEnd<L>,
              "List<T> needs `iterator begin()`, `iterator end()`, and const overloads returning const_iterator");
static_assert(std::bidirectional_iterator<typename L::iterator>,
              "List<T>::iterator must satisfy std::bidirectional_iterator: default constructible and copyable, "
              "member types iterator_category (std::bidirectional_iterator_tag), value_type, difference_type, "
              "pointer and reference, `reference operator*() const`, prefix and postfix ++ and --, and ==");
static_assert(std::bidirectional_iterator<typename L::const_iterator>,
              "List<T>::const_iterator must satisfy std::bidirectional_iterator (see iterator)");
static_assert(std::is_same_v<std::iter_value_t<typename L::iterator>, Tracked> &&
                  std::is_same_v<std::iter_reference_t<typename L::iterator>, Tracked&> &&
                  std::is_same_v<std::iter_value_t<typename L::const_iterator>, Tracked> &&
                  std::is_same_v<std::iter_reference_t<typename L::const_iterator>, const Tracked&>,
              "List<T>: *iterator must be T& and *const_iterator const T&; both have value_type T");
static_assert(HasArrow<L>, "the iterators need `operator->() const` returning T* (const T* for const_iterator)");
static_assert(std::is_convertible_v<typename L::iterator, typename L::const_iterator>,
              "List<T>::iterator must convert implicitly to const_iterator (insert, erase and splice take const_iterator)");
static_assert(!std::is_convertible_v<typename L::const_iterator, typename L::iterator>,
              "a const_iterator must not convert to an iterator: that would allow modifying through it");
static_assert(std::ranges::bidirectional_range<L> && std::ranges::bidirectional_range<const L>,
              "List<T> and const List<T> must be bidirectional ranges (usable in a range-for)");
static_assert(HasAccess<L>,
              "List<T> needs `std::size_t size() const`, `bool empty() const`, and front()/back() returning T& "
              "with const overloads returning const T&");
static_assert(HasModifiers<L>,
              "List<T> needs push_back/push_front (const T& and T&&), pop_back(), pop_front(), insert(const_iterator, "
              "const T& / T&&) and emplace(const_iterator, Args&&...) returning iterator, erase(const_iterator) "
              "returning iterator, clear(), splice(const_iterator, List&) and splice(const_iterator, List&, "
              "const_iterator), and reverse()");

}  // namespace ipp_harness_list

// Replacements for the global allocation functions (counted while the candidate's code runs).
void* operator new(std::size_t n) { return ipp_harness_list::allocate(n); }
void* operator new[](std::size_t n) { return ipp_harness_list::allocate(n); }
void* operator new(std::size_t n, const std::nothrow_t&) noexcept {
    try {
        return ipp_harness_list::allocate(n);
    } catch (...) {
        return nullptr;
    }
}
void* operator new[](std::size_t n, const std::nothrow_t&) noexcept {
    try {
        return ipp_harness_list::allocate(n);
    } catch (...) {
        return nullptr;
    }
}
void operator delete(void* p) noexcept { ipp_harness_list::deallocate(p); }
void operator delete[](void* p) noexcept { ipp_harness_list::deallocate(p); }
void operator delete(void* p, std::size_t) noexcept { ipp_harness_list::deallocate(p); }
void operator delete[](void* p, std::size_t) noexcept { ipp_harness_list::deallocate(p); }
void operator delete(void* p, const std::nothrow_t&) noexcept { ipp_harness_list::deallocate(p); }
void operator delete[](void* p, const std::nothrow_t&) noexcept { ipp_harness_list::deallocate(p); }

class ListHarness {
    using Tracked = ipp_harness_list::Tracked;
    using L = ipp_harness_list::L;
    using It = L::iterator;
    using CIt = L::const_iterator;
    using Op = ipp_harness_list::Op;
    using Pause = ipp_harness_list::Pause;
    static constexpr int kLists = 4;
    static constexpr int kIters = 8;
    std::optional<L> lists_[kLists];
    std::optional<It> iters_[kIters];

    static ipp_harness_list::State& st() { return ipp_harness_list::state(); }
    static void error(const std::string& e) { ipp_harness_list::error(e); }

    std::optional<L>& slot(int s) {
        if (s < 0 || s >= kLists) throw std::invalid_argument("test error: no list slot " + std::to_string(s));
        return lists_[s];
    }
    L& held(int s) {
        auto& o = slot(s);
        if (!o) throw std::invalid_argument("test error: list slot " + std::to_string(s) + " holds no List");
        return *o;
    }
    std::optional<It>& iterSlot(int i) {
        if (i < 0 || i >= kIters) throw std::invalid_argument("test error: no iterator slot " + std::to_string(i));
        return iters_[i];
    }
    It& iter(int i) {
        auto& o = iterSlot(i);
        if (!o) throw std::invalid_argument("test error: iterator slot " + std::to_string(i) + " holds no iterator");
        return *o;
    }
    static std::size_t sizeOf(const L& l) {
        Op op;
        return l.size();
    }
    static int read(const Tracked& t) {
        if (!ipp_harness_list::isLive(&t)) {
            error("an element read through the List is not alive (destroyed, or never constructed)");
            return -2;
        }
        return t.value;
    }
    // The element an iterator refers to; reports operator* and operator-> disagreeing.
    static int readIt(const It& it) {
        Tracked* a;
        Tracked* b;
        {
            Op op;
            a = &*it;
            b = it.operator->();
        }
        if (a != b) error("operator* and operator-> of the iterator refer to different elements");
        return read(*a);
    }
    static int readOrEnd(L& l, const It& it) {
        bool atEnd;
        {
            Op op;
            atEnd = it == l.end();
        }
        return atEnd ? -1 : readIt(it);
    }

public:
    ListHarness() {
        {
            Pause p;
            st().clear();
        }
        ipp_harness_list::resetHeap();
    }
    ~ListHarness() {
        Op op;
        for (auto& o : lists_) o.reset();
    }
    ListHarness(const ListHarness&) = delete;
    ListHarness& operator=(const ListHarness&) = delete;

    // lists[s].emplace()   (an existing List in the slot is destroyed first)
    void create(int s) {
        auto& o = slot(s);
        Op op;
        o.emplace();
    }

    // Tracked t(value); lists[s]->push_back(t) (or std::move(t) when move)
    void pushBack(int s, int value, bool move) {
        L& l = held(s);
        Tracked t(value);
        Op op;
        if (move) l.push_back(std::move(t));
        else l.push_back(std::as_const(t));
    }

    // Tracked t(value); lists[s]->push_front(t) (or std::move(t) when move)
    void pushFront(int s, int value, bool move) {
        L& l = held(s);
        Tracked t(value);
        Op op;
        if (move) l.push_front(std::move(t));
        else l.push_front(std::as_const(t));
    }

    // lists[s]->pop_back()
    void popBack(int s) {
        L& l = held(s);
        if (sizeOf(l) == 0) throw std::logic_error("size() is 0 before a pop: the tests only pop non-empty lists, so size() looks wrong");
        Op op;
        l.pop_back();
    }

    // lists[s]->pop_front()
    void popFront(int s) {
        L& l = held(s);
        if (sizeOf(l) == 0) throw std::logic_error("size() is 0 before a pop: the tests only pop non-empty lists, so size() looks wrong");
        Op op;
        l.pop_front();
    }

    // lists[s]->front().value   (also compares the const overload)
    int front(int s) {
        L& l = held(s);
        Tracked* a;
        const Tracked* b;
        {
            Op op;
            a = &l.front();
            b = &std::as_const(l).front();
        }
        if (a != b) error("front() and its const overload return different elements");
        return read(*a);
    }

    // lists[s]->back().value   (also compares the const overload)
    int back(int s) {
        L& l = held(s);
        Tracked* a;
        const Tracked* b;
        {
            Op op;
            a = &l.back();
            b = &std::as_const(l).back();
        }
        if (a != b) error("back() and its const overload return different elements");
        return read(*a);
    }

    // lists[s]->size()   (also checks empty())
    int size(int s) {
        const L& l = held(s);
        Op op;
        std::size_t n = l.size();
        if (l.empty() != (n == 0)) error("empty() disagrees with size()");
        return static_cast<int>(n);
    }

    // the values from front to back, walking a const_iterator from std::as_const(*lists[s]).begin()
    // to end() with ++ (at most size() steps)
    std::vector<int> contents(int s) {
        const L& l = held(s);
        std::size_t n = sizeOf(l);
        std::vector<int> out;
        {
            Pause p;
            out.reserve(n);
        }
        CIt it, last;
        {
            Op op;
            it = l.begin();
            last = l.end();
        }
        for (std::size_t k = 0;; ++k) {
            bool done;
            {
                Op op;
                done = it == last;
            }
            if (done) {
                if (k != n) error("walking forward from begin() reaches end() after fewer than size() steps");
                break;
            }
            if (k == n) {
                error("walking forward from begin() does not reach end() after size() steps");
                break;
            }
            const Tracked* t;
            {
                Op op;
                t = &*it;
                ++it;
            }
            int x = read(*t);
            Pause p;
            out.push_back(x);
        }
        return out;
    }

    // the values from back to front, walking an iterator from lists[s]->end() back to begin()
    // with -- (at most size() steps)
    std::vector<int> contentsReversed(int s) {
        L& l = held(s);
        std::size_t n = sizeOf(l);
        std::vector<int> out;
        {
            Pause p;
            out.reserve(n);
        }
        It it, first;
        {
            Op op;
            it = l.end();
            first = l.begin();
        }
        for (std::size_t k = 0;; ++k) {
            bool done;
            {
                Op op;
                done = it == first;
            }
            if (done) {
                if (k != n) error("walking backward from end() reaches begin() after fewer than size() steps");
                break;
            }
            if (k == n) {
                error("walking backward from end() does not reach begin() after size() steps");
                break;
            }
            Tracked* t;
            {
                Op op;
                --it;
                t = &*it;
            }
            int x = read(*t);
            Pause p;
            out.push_back(x);
        }
        return out;
    }

    // lists[s]->clear()
    void clear(int s) {
        L& l = held(s);
        Op op;
        l.clear();
    }

    // lists[s]->reverse()
    void reverse(int s) {
        L& l = held(s);
        Op op;
        l.reverse();
    }

    // its[i] = lists[s]->begin()
    void itBegin(int i, int s) {
        L& l = held(s);
        auto& o = iterSlot(i);
        Op op;
        o = l.begin();
    }

    // its[i] = lists[s]->end()
    void itEnd(int i, int s) {
        L& l = held(s);
        auto& o = iterSlot(i);
        Op op;
        o = l.end();
    }

    // ++its[i]   (checks that it returns its[i] itself)
    void itNext(int i) {
        It& it = iter(i);
        Op op;
        if (&++it != &it) error("prefix ++ must return a reference to the iterator itself");
    }

    // --its[i]   (checks that it returns its[i] itself)
    void itPrev(int i) {
        It& it = iter(i);
        Op op;
        if (&--it != &it) error("prefix -- must return a reference to the iterator itself");
    }

    // (*its[i]++).value   (postfix: the value at the old position; its[i] moves on)
    int itPostNext(int i) {
        It& it = iter(i);
        It old;
        {
            Op op;
            old = it++;
        }
        return readIt(old);
    }

    // its[i]->value   (also compares (*its[i]).value)
    int itGet(int i) { return readIt(iter(i)); }

    // its[i] == its[j]   (also checks !=)
    bool itEq(int i, int j) {
        const It& a = iter(i);
        const It& b = iter(j);
        Op op;
        bool eq = a == b;
        if (eq == (a != b)) error("== and != of the iterator disagree");
        return eq;
    }

    // its[j] = its[i]
    void itCopy(int i, int j) {
        const It& a = iter(i);
        auto& o = iterSlot(j);
        Op op;
        o = a;
    }

    // Tracked t(value); its[out] = lists[s]->insert(its[pos], t) (or std::move(t) when move);
    // returns its[out]->value   (out may equal pos)
    int insert(int s, int pos, int value, bool move, int out) {
        L& l = held(s);
        CIt p = iter(pos);
        auto& o = iterSlot(out);
        Tracked t(value);
        {
            Op op;
            o = move ? l.insert(p, std::move(t)) : l.insert(p, std::as_const(t));
        }
        return readIt(*o);
    }

    // its[out] = lists[s]->emplace(its[pos], value, Label{}); returns its[out]->value
    // (constructs Tracked(int, Label&&); Label{} is an rvalue that must arrive as one)
    int emplace(int s, int pos, int value, int out) {
        L& l = held(s);
        CIt p = iter(pos);
        auto& o = iterSlot(out);
        {
            Op op;
            o = l.emplace(p, value, ipp_harness_list::Label{});
        }
        return readIt(*o);
    }

    // its[out] = lists[s]->erase(its[pos]); returns its[out]->value, or -1 if it is end()
    // (out may equal pos)
    int erase(int s, int pos, int out) {
        L& l = held(s);
        CIt p = iter(pos);
        auto& o = iterSlot(out);
        if (sizeOf(l) == 0) throw std::logic_error("size() is 0 before an erase: the tests only erase elements, so size() looks wrong");
        {
            Op op;
            o = l.erase(p);
        }
        return readOrEnd(l, *o);
    }

    // lists[s]->splice(its[pos], *lists[other])   (other != s)
    void splice(int s, int pos, int other) {
        if (s == other) throw std::invalid_argument("test error: splice needs two lists");
        L& l = held(s);
        L& o = held(other);
        CIt p = iter(pos);
        Op op;
        l.splice(p, o);
    }

    // lists[s]->splice(its[pos], *lists[other], its[it])   (other may equal s)
    void spliceOne(int s, int pos, int other, int it) {
        L& l = held(s);
        L& o = held(other);
        CIt p = iter(pos);
        CIt e = iter(it);
        Op op;
        l.splice(p, o, e);
    }

    // lists[to].emplace(std::as_const(*lists[from]))   (from != to)
    void copyConstruct(int from, int to) {
        if (from == to) throw std::invalid_argument("test error: copyConstruct needs two slots");
        L& src = held(from);
        auto& dst = slot(to);
        Op op;
        dst.emplace(std::as_const(src));
    }

    // *lists[to] = std::as_const(*lists[from])   (from may equal to)
    void copyAssign(int from, int to) {
        L& src = held(from);
        L& dst = held(to);
        Op op;
        dst = std::as_const(src);
    }

    // lists[to].emplace(std::move(*lists[from]))   (from != to)
    void moveConstruct(int from, int to) {
        if (from == to) throw std::invalid_argument("test error: moveConstruct needs two slots");
        L& src = held(from);
        auto& dst = slot(to);
        Op op;
        dst.emplace(std::move(src));
    }

    // *lists[to] = std::move(*lists[from])   (from may equal to)
    void moveAssign(int from, int to) {
        L& src = held(from);
        L& dst = held(to);
        Op op;
        dst = std::move(src);
    }

    // destroys the List in slot s; the slot becomes empty
    void destroy(int s) {
        held(s);
        Op op;
        slot(s).reset();
    }

    // destroy every non-empty list slot, in slot order
    void destroyAll() {
        Op op;
        for (auto& o : lists_) o.reset();
    }

    // number of Tracked objects currently alive
    int alive() {
        Pause p;
        return static_cast<int>(st().live.size());
    }

    // Tracked copies (constructions + assignments) so far in this test
    int copies() { return static_cast<int>(st().copies); }

    // Tracked moves (constructions + assignments) so far in this test
    int moves() { return static_cast<int>(st().moves); }

    // heap blocks allocated by List operations and not yet freed
    int heapBlocks() { return static_cast<int>(ipp_harness_list::g_live.count); }

    // problems the harness detected; [] when all is well
    std::vector<std::string> errors() {
        Pause p;
        std::vector<std::string> e = st().errors;
        if (ipp_harness_list::g_doubleFrees)
            e.push_back(std::to_string(ipp_harness_list::g_doubleFrees) + " heap block(s) freed twice");
        if (ipp_harness_list::g_overflow) e.push_back("harness: too many heap allocations to track");
        return e;
    }
};
