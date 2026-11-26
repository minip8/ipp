// interview++ test harness for "unordered-map". Appended after the candidate's code in judged runs.
//
// The tests drive HashMapHarness: four numbered slots, each either empty or holding one
// ::HashMap<Key, Val, KeyHash, KeyEq>. Every method performs one C++ operation or reports what
// happened. Key and Val record every construction, copy, move and destruction by address, so
// element-lifetime bugs (elements copied on rehash, destroyed twice or never, a key moved from
// when it should not be) show up as wrong values or as entries in errors(). KeyHash is either
// the identity or a constant (every key collides), chosen by the harness constructor's argument.
// The global operator new/delete are replaced so the heap blocks the candidate allocates (nodes
// and bucket arrays) can be counted; freed blocks are quarantined until the next test, so a
// double free becomes a counted error.

#include <algorithm>
#include <cmath>
#include <concepts>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <iterator>
#include <new>
#include <optional>
#include <stdexcept>
#include <string>
#include <type_traits>
#include <unordered_set>
#include <utility>
#include <vector>

namespace ipp_harness_um {

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
// No test needs more than a few MB; refusing huge requests keeps a runaway bug contained.
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
        // Keep freed blocks (so a double free or a late access cannot corrupt the heap), up to a
        // budget so a bug that allocates on every operation cannot exhaust memory.
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
    std::unordered_set<const void*> live;  // addresses of live Key and Val objects
    long copies = 0;                       // copy constructions + copy assignments
    long moves = 0;                        // move constructions + move assignments
    int hashMode = 0;                      // 0: identity, 1: every key hashes to 0
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

inline void born(const void* p, const char* what) {
    Pause g;
    if (!state().live.insert(p).second)
        state().error(std::string("a ") + what + " was constructed on top of a live one that was never destroyed");
}

inline void died(const void* p, const char* what) {
    Pause g;
    if (!state().live.erase(p))
        state().error(std::string("a ") + what + " was destroyed twice, or destroyed without having been constructed");
}

inline int readFrom(const void* p, int v, const char* what, const char* how) {
    if (isLive(p)) return v;
    error(std::string("a ") + what + " was " + how + " from an object that is not alive (destroyed, or never constructed)");
    return -3;
}

/// Passed to try_emplace as an rvalue, to check perfect forwarding.
struct Label {};

/// The key type: no default constructor, no operator==, no std::hash (the map must use its
/// Hash and KeyEqual parameters). Copyable and nothrow movable; a moved-from Key has value -1.
struct Key {
    int value;

    Key() = delete;
    explicit Key(int v) : value(v) { born(this, "key"); }
    Key(const Key& o) : value(readFrom(&o, o.value, "key", "copied")) {
        born(this, "key");
        ++state().copies;
    }
    Key(Key&& o) noexcept : value(readFrom(&o, o.value, "key", "moved")) {
        born(this, "key");
        ++state().moves;
        if (isLive(&o)) o.value = -1;
    }
    Key& operator=(const Key&) = delete;  // keys in a map are const
    Key& operator=(Key&&) = delete;
    ~Key() { died(this, "key"); }
};

/// The mapped type: default constructible (value 0) for operator[], copyable, nothrow movable;
/// a moved-from Val has value -1.
struct Val {
    int value;

    Val() : value(0) { born(this, "value"); }
    explicit Val(int v) : value(v) { born(this, "value"); }
    Val(int v, Label&&) : value(v) { born(this, "value"); }
    Val(int v, const Label&) : value(v) {
        born(this, "value");
        error("try_emplace received an rvalue argument but passed it on as an lvalue: use std::forward");
    }
    Val(const Val& o) : value(readFrom(&o, o.value, "value", "copied")) {
        born(this, "value");
        ++state().copies;
    }
    Val(Val&& o) noexcept : value(readFrom(&o, o.value, "value", "moved")) {
        born(this, "value");
        ++state().moves;
        if (isLive(&o)) o.value = -1;
    }
    Val& operator=(const Val& o) {
        if (!isLive(this)) error("a value was assigned to raw memory");
        value = readFrom(&o, o.value, "value", "copied");
        ++state().copies;
        return *this;
    }
    Val& operator=(Val&& o) noexcept {
        if (!isLive(this)) error("a value was assigned to raw memory");
        int v = readFrom(&o, o.value, "value", "moved");
        if (isLive(&o)) o.value = -1;
        value = v;
        ++state().moves;
        return *this;
    }
    ~Val() { died(this, "value"); }
};

struct KeyHash {
    std::size_t operator()(const Key& k) const {
        if (!isLive(&k)) error("the hash function was called on a key that is not alive");
        return state().hashMode == 1 ? 0 : static_cast<std::size_t>(k.value);
    }
};

struct KeyEq {
    bool operator()(const Key& a, const Key& b) const { return a.value == b.value; }
};

using M = ::HashMap<Key, Val, KeyHash, KeyEq>;
using VT = std::pair<const Key, Val>;

// ---- compile-time requirements (checked before any test runs) ----
template <class X> concept HasTypes = requires {
    typename X::key_type;
    typename X::mapped_type;
    typename X::value_type;
    typename X::iterator;
};
template <class X> concept HasLookup = requires(X& m, const X& cm, const Key& k) {
    { m.find(k) } -> std::same_as<typename X::iterator>;
    { cm.contains(k) } -> std::same_as<bool>;
    { m.at(k) } -> std::same_as<Val&>;
    { cm.at(k) } -> std::same_as<const Val&>;
};
template <class X> concept HasInsert = requires(X& m, const VT& kv, const Key& k, Key&& rk, int v) {
    { m.insert(kv) } -> std::same_as<std::pair<typename X::iterator, bool>>;
    { m.try_emplace(k, v, Label{}) } -> std::same_as<std::pair<typename X::iterator, bool>>;
    { m.try_emplace(static_cast<Key&&>(rk), v, Label{}) } -> std::same_as<std::pair<typename X::iterator, bool>>;
    { m[k] } -> std::same_as<Val&>;
    { m[static_cast<Key&&>(rk)] } -> std::same_as<Val&>;
};
template <class X> concept HasErase = requires(X& m, const Key& k) {
    { m.erase(k) } -> std::same_as<std::size_t>;
    m.clear();
};
template <class X> concept HasBuckets = requires(X& m, const X& cm, const Key& k, std::size_t n) {
    { cm.size() } -> std::same_as<std::size_t>;
    { cm.empty() } -> std::same_as<bool>;
    { cm.bucket_count() } -> std::same_as<std::size_t>;
    { cm.load_factor() } -> std::same_as<float>;
    { cm.bucket(k) } -> std::same_as<std::size_t>;
    { cm.bucket_size(n) } -> std::same_as<std::size_t>;
    m.rehash(n);
    m.reserve(n);
};
template <class I> concept MapIterator = std::copyable<I> && std::default_initializable<I> &&
    requires(I i, const I ci) {
        { *ci } -> std::same_as<VT&>;
        { ci.operator->() } -> std::same_as<VT*>;
        { ++i } -> std::same_as<I&>;
        { i++ } -> std::same_as<I>;
        { ci == ci } -> std::same_as<bool>;
        { ci != ci } -> std::same_as<bool>;
    };
template <class X> concept HasIter = requires(X& m) {
    { m.begin() } -> std::same_as<typename X::iterator>;
    { m.end() } -> std::same_as<typename X::iterator>;
};

static_assert(!std::is_default_constructible_v<Key> && !std::equality_comparable<Key>, "harness self-check");
static_assert(HasTypes<M>,
              "HashMap needs the member types key_type, mapped_type, value_type and iterator");
static_assert(std::is_same_v<typename M::key_type, Key> && std::is_same_v<typename M::mapped_type, Val> &&
                  std::is_same_v<typename M::value_type, VT>,
              "HashMap<K, V, ...>: key_type must be K, mapped_type V and value_type std::pair<const K, V>");
static_assert(std::is_nothrow_default_constructible_v<M>,
              "HashMap() must exist and be noexcept (an empty map has no buckets and allocates nothing)");
static_assert(std::is_copy_constructible_v<M>, "HashMap needs a copy constructor");
static_assert(std::is_copy_assignable_v<M>, "HashMap needs a copy assignment operator");
static_assert(std::is_nothrow_move_constructible_v<M>, "HashMap(HashMap&&) must exist and be noexcept");
static_assert(std::is_nothrow_move_assignable_v<M>, "HashMap::operator=(HashMap&&) must exist and be noexcept");
static_assert(HasLookup<M>,
              "HashMap needs `iterator find(const K&)`, `bool contains(const K&) const`, and `V& at(const K&)` "
              "with a const overload returning const V&");
static_assert(HasInsert<M>,
              "HashMap needs `std::pair<iterator, bool> insert(const value_type&)`, `try_emplace(const K&, Args&&...)` "
              "and `try_emplace(K&&, Args&&...)` returning std::pair<iterator, bool>, and `V& operator[]` for "
              "const K& and K&&");
static_assert(HasErase<M>, "HashMap needs `std::size_t erase(const K&)` and `void clear()`");
static_assert(HasBuckets<M>,
              "HashMap needs const `size()`, `empty()`, `bucket_count()`, `float load_factor()`, `bucket(const K&)` "
              "and `bucket_size(std::size_t)` (std::size_t results except where stated), plus `rehash(std::size_t)` "
              "and `reserve(std::size_t)`");
static_assert(HasIter<M>, "HashMap needs `iterator begin()` and `iterator end()`");
static_assert(MapIterator<typename M::iterator>,
              "HashMap::iterator must be default constructible and copyable, with `value_type& operator*() const`, "
              "`value_type* operator->() const`, prefix and postfix ++, and == / !=");

}  // namespace ipp_harness_um

// Replacements for the global allocation functions (counted while the candidate's code runs).
void* operator new(std::size_t n) { return ipp_harness_um::allocate(n); }
void* operator new[](std::size_t n) { return ipp_harness_um::allocate(n); }
void* operator new(std::size_t n, const std::nothrow_t&) noexcept {
    try {
        return ipp_harness_um::allocate(n);
    } catch (...) {
        return nullptr;
    }
}
void* operator new[](std::size_t n, const std::nothrow_t&) noexcept {
    try {
        return ipp_harness_um::allocate(n);
    } catch (...) {
        return nullptr;
    }
}
void operator delete(void* p) noexcept { ipp_harness_um::deallocate(p); }
void operator delete[](void* p) noexcept { ipp_harness_um::deallocate(p); }
void operator delete(void* p, std::size_t) noexcept { ipp_harness_um::deallocate(p); }
void operator delete[](void* p, std::size_t) noexcept { ipp_harness_um::deallocate(p); }
void operator delete(void* p, const std::nothrow_t&) noexcept { ipp_harness_um::deallocate(p); }
void operator delete[](void* p, const std::nothrow_t&) noexcept { ipp_harness_um::deallocate(p); }

class HashMapHarness {
    using Key = ipp_harness_um::Key;
    using Val = ipp_harness_um::Val;
    using M = ipp_harness_um::M;
    using VT = ipp_harness_um::VT;
    using Op = ipp_harness_um::Op;
    using Pause = ipp_harness_um::Pause;
    static constexpr int kSlots = 4;
    std::optional<M> slots_[kSlots];

    static ipp_harness_um::State& st() { return ipp_harness_um::state(); }
    static void error(const std::string& e) { ipp_harness_um::error(e); }

    std::optional<M>& slot(int s) {
        if (s < 0 || s >= kSlots) throw std::invalid_argument("test error: no slot " + std::to_string(s));
        return slots_[s];
    }
    M& held(int s) {
        auto& o = slot(s);
        if (!o) throw std::invalid_argument("test error: slot " + std::to_string(s) + " holds no HashMap");
        return *o;
    }
    static std::size_t sizeOf(const M& m) {
        Op op;
        return m.size();
    }
    static int read(const Val& v) {
        if (!ipp_harness_um::isLive(&v)) {
            error("a value read through the HashMap is not alive (destroyed, or never constructed)");
            return -2;
        }
        return v.value;
    }
    // The iterator returned by an insertion or lookup must point at the element with this key.
    static void checkKey(const VT& kv, int k, const char* what) {
        if (!ipp_harness_um::isLive(&kv.first) || kv.first.value != k)
            error(std::string(what) + " returned an iterator that does not point at the element with that key");
    }

public:
    // hashMode 0: KeyHash(k) == k.value; hashMode 1: KeyHash(k) == 0 for every key.
    explicit HashMapHarness(int hashMode) {
        {
            Pause p;
            st().clear();
        }
        st().hashMode = hashMode;
        ipp_harness_um::resetHeap();
    }
    ~HashMapHarness() {
        Op op;
        for (auto& o : slots_) o.reset();
    }
    HashMapHarness(const HashMapHarness&) = delete;
    HashMapHarness& operator=(const HashMapHarness&) = delete;

    // slots[s].emplace()   (an existing HashMap in the slot is destroyed first)
    void create(int s) {
        auto& o = slot(s);
        Op op;
        o.emplace();
    }

    // const std::pair<const Key, Val> kv(Key(k), Val(v)); slots[s]->insert(kv).second
    bool insert(int s, int k, int v) {
        M& m = held(s);
        const VT kv(std::piecewise_construct, std::forward_as_tuple(k), std::forward_as_tuple(v));
        std::pair<M::iterator, bool> r;
        {
            Op op;
            r = m.insert(kv);
        }
        checkKey(*r.first, k, "insert");
        return r.second;
    }

    // Key key(k); slots[s]->try_emplace(std::move(key), v, Label{}).second
    bool tryEmplace(int s, int k, int v) {
        M& m = held(s);
        Key key(k);
        std::pair<M::iterator, bool> r;
        {
            Op op;
            r = m.try_emplace(std::move(key), v, ipp_harness_um::Label{});
        }
        if (!r.second && key.value != k)
            error("try_emplace moved from its key argument although the key was already present");
        checkKey(*r.first, k, "try_emplace");
        return r.second;
    }

    // Key key(k); Val& r = (*slots[s])[key] (or [std::move(key)] when rvalue);
    // returns r.value before setting r.value = v
    int subscript(int s, int k, int v, bool rvalue) {
        M& m = held(s);
        Key key(k);
        Val* r;
        {
            Op op;
            r = rvalue ? &m[std::move(key)] : &m[std::as_const(key)];
        }
        int old = read(*r);
        if (old >= 0) r->value = v;
        return old;
    }

    // std::as_const(*slots[s]).at(Key(k)).value, or -1 if it throws std::out_of_range
    int at(int s, int k) {
        const M& m = held(s);
        const Key key(k);
        const Val* r;
        try {
            Op op;
            r = &m.at(key);
        } catch (const std::out_of_range&) {
            return -1;
        }
        return read(*r);
    }

    // auto it = slots[s]->find(Key(k)); it == end() ? -1 : it->second.value
    int find(int s, int k) {
        M& m = held(s);
        const Key key(k);
        M::iterator it;
        bool atEnd;
        {
            Op op;
            it = m.find(key);
            atEnd = it == m.end();
        }
        if (atEnd) return -1;
        checkKey(*it, k, "find");
        return read(it->second);
    }

    // std::as_const(*slots[s]).contains(Key(k))
    bool contains(int s, int k) {
        const M& m = held(s);
        const Key key(k);
        Op op;
        return m.contains(key);
    }

    // slots[s]->erase(Key(k))   (the number of elements removed)
    int erase(int s, int k) {
        M& m = held(s);
        const Key key(k);
        Op op;
        return static_cast<int>(m.erase(key));
    }

    // slots[s]->size()   (also checks empty())
    int size(int s) {
        const M& m = held(s);
        Op op;
        std::size_t n = m.size();
        if (m.empty() != (n == 0)) error("empty() disagrees with size()");
        return static_cast<int>(n);
    }

    // slots[s]->bucket_count()   (also checks load_factor() == size() / bucket_count())
    int bucketCount(int s) {
        const M& m = held(s);
        Op op;
        std::size_t n = m.bucket_count();
        float lf = m.load_factor();
        float want = n ? static_cast<float>(m.size()) / static_cast<float>(n) : 0.0f;
        if (std::fabs(lf - want) > 1e-6f) error("load_factor() is not size() / bucket_count() (0 with no buckets)");
        return static_cast<int>(n);
    }

    // slots[s]->bucket(Key(k))
    int bucketOf(int s, int k) {
        const M& m = held(s);
        const Key key(k);
        Op op;
        return static_cast<int>(m.bucket(key));
    }

    // slots[s]->bucket_size(i)
    int bucketSize(int s, int i) {
        const M& m = held(s);
        Op op;
        return static_cast<int>(m.bucket_size(static_cast<std::size_t>(i)));
    }

    // slots[s]->rehash(n)
    void rehash(int s, int n) {
        M& m = held(s);
        Op op;
        m.rehash(static_cast<std::size_t>(n));
    }

    // slots[s]->reserve(n)
    void reserve(int s, int n) {
        M& m = held(s);
        Op op;
        m.reserve(static_cast<std::size_t>(n));
    }

    // slots[s]->clear()
    void clear(int s) {
        M& m = held(s);
        Op op;
        m.clear();
    }

    // every element as "key=value", read by iterating from begin() to end(), sorted by key
    std::vector<std::string> contents(int s) {
        M& m = held(s);
        std::size_t n = sizeOf(m);
        std::vector<std::pair<int, int>> seen;
        {
            Pause p;
            seen.reserve(n);
        }
        M::iterator it, last;
        {
            Op op;
            it = m.begin();
            last = m.end();
        }
        std::size_t steps = 0;
        bool tooMany = false;
        while (true) {
            bool done;
            {
                Op op;
                done = it == last;
            }
            if (done) break;
            if (++steps > n) {
                error("iterating from begin() visits more elements than size(), or never reaches end()");
                tooMany = true;
                break;
            }
            VT& kv = *it;
            int k = ipp_harness_um::isLive(&kv.first) ? kv.first.value : -2;
            int v = read(kv.second);
            if (&it->second != &kv.second) error("operator-> and operator* of the iterator disagree");
            {
                Pause p;
                seen.emplace_back(k, v);
            }
            Op op;
            ++it;
        }
        Pause p;
        if (!tooMany && steps < n) error("iterating from begin() to end() visits fewer elements than size()");
        std::sort(seen.begin(), seen.end());
        std::vector<std::string> out;
        for (std::size_t i = 0; i < seen.size(); ++i) {
            if (i && seen[i].first == seen[i - 1].first) error("iteration visits the same key twice");
            out.push_back(std::to_string(seen[i].first) + "=" + std::to_string(seen[i].second));
        }
        return out;
    }

    // slots[to].emplace(*slots[from])   (from != to)
    void copyConstruct(int from, int to) {
        if (from == to) throw std::invalid_argument("test error: copyConstruct needs two slots");
        M& src = held(from);
        auto& dst = slot(to);
        Op op;
        dst.emplace(std::as_const(src));
    }

    // *slots[to] = *slots[from]   (from may equal to)
    void copyAssign(int from, int to) {
        M& src = held(from);
        M& dst = held(to);
        Op op;
        dst = std::as_const(src);
    }

    // slots[to].emplace(std::move(*slots[from]))   (from != to)
    void moveConstruct(int from, int to) {
        if (from == to) throw std::invalid_argument("test error: moveConstruct needs two slots");
        M& src = held(from);
        auto& dst = slot(to);
        Op op;
        dst.emplace(std::move(src));
    }

    // *slots[to] = std::move(*slots[from])   (from may equal to)
    void moveAssign(int from, int to) {
        M& src = held(from);
        M& dst = held(to);
        Op op;
        dst = std::move(src);
    }

    // destroys the HashMap in slot s; the slot becomes empty
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

    // number of Key and Val objects currently alive (two per element)
    int alive() {
        Pause p;
        return static_cast<int>(st().live.size());
    }

    // Key and Val copies (constructions + assignments) so far in this test
    int copies() { return static_cast<int>(st().copies); }

    // Key and Val moves (constructions + assignments) so far in this test
    int moves() { return static_cast<int>(st().moves); }

    // heap blocks allocated by HashMap operations and not yet freed
    int heapBlocks() { return static_cast<int>(ipp_harness_um::g_live.count); }

    // problems the harness detected; [] when all is well
    std::vector<std::string> errors() {
        Pause p;
        std::vector<std::string> e = st().errors;
        if (ipp_harness_um::g_doubleFrees)
            e.push_back(std::to_string(ipp_harness_um::g_doubleFrees) + " heap block(s) freed twice");
        if (ipp_harness_um::g_overflow) e.push_back("harness: too many heap allocations to track");
        return e;
    }
};
