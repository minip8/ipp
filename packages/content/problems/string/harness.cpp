// interview++ test harness for "string". Appended after the candidate's code in judged runs.
//
// The tests drive StringHarness: four numbered slots, each either empty or holding one ::String.
// Every method performs one C++ operation or reports what happened. The global operator new and
// delete are replaced so the buffers the candidate allocates can be observed: blocks allocated
// while the candidate's code runs are counted, filled with garbage (so a missing '\0' shows), and
// followed by a guard zone (so writing past the end shows); freed blocks are scribbled over and
// quarantined until the next test, so a double free becomes a counted error and a read after
// free returns garbage instead of the old characters.

#include <concepts>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <new>
#include <optional>
#include <stdexcept>
#include <string>
#include <type_traits>
#include <utility>
#include <vector>

namespace ipp_harness_str {

// ---------------------------------------------------------------- heap accounting
// Plain arrays and integers only: this runs inside operator new, before and after main.
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
    std::size_t find(const void* p) const {
        if (count == 0) return kCap;
        for (std::size_t i = hash(const_cast<void*>(p));; i = (i + 1) & (kCap - 1)) {
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
    template <class F> void each(F f) const {
        for (std::size_t i = 0; i < kCap; ++i)
            if (slots[i] != nullptr && slots[i] != tomb()) f(slots[i], sizes[i]);
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
inline long g_allocations = 0;  // counted allocations in this test
inline long g_doubleFrees = 0;
inline long g_overruns = 0;     // counted blocks whose guard zone was overwritten
inline std::size_t g_quarantineBytes = 0;
inline constexpr std::size_t kMaxBlock = std::size_t(64) << 20;
inline constexpr std::size_t kGuard = 16;
inline constexpr unsigned char kGuardByte = 0xA5, kFreshByte = 0xCD, kFreedByte = 0xDD;

inline bool counting() { return g_counting && g_pause == 0; }

inline bool guardIntact(const void* p, std::size_t n) {
    const unsigned char* g = static_cast<const unsigned char*>(p) + n;
    for (std::size_t i = 0; i < kGuard; ++i)
        if (g[i] != kGuardByte) return false;
    return true;
}

inline void* allocate(std::size_t n) {
    if (counting() && n > kMaxBlock) throw std::bad_alloc();
    void* p = std::malloc(n + kGuard);
    if (!p) throw std::bad_alloc();
    std::memset(static_cast<unsigned char*>(p) + n, kGuardByte, kGuard);
    if (counting()) {
        std::memset(p, kFreshByte, n);
        ++g_allocations;
        if (!g_live.insert(p, n)) g_overflow = true;
    }
    return p;
}

inline void deallocate(void* p) noexcept {
    if (!p) return;
    std::size_t n = g_live.erase(p);
    if (n != PtrTable::kMissing) {
        if (!guardIntact(p, n)) ++g_overruns;
        // Keep freed storage (so a double free or late access cannot corrupt the heap), up to a
        // budget so a reallocate-on-every-push bug cannot exhaust memory.
        if (g_quarantineBytes + n > (std::size_t(32) << 20) || !g_quarantine.insert(p, n)) {
            std::free(p);
        } else {
            std::memset(p, kFreedByte, n);
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
    g_allocations = 0;
    g_doubleFrees = 0;
    g_overruns = 0;
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

struct Errors {
    std::vector<std::string> list;
    void add(const std::string& e) {
        for (auto& x : list)
            if (x == e) return;
        if (list.size() < 20) list.push_back(e);
    }
};
inline Errors& errs() {
    static Errors e;
    return e;
}

using S = ::String;

// ---- compile-time requirements (checked before any test runs) ----
template <class X> concept HasObservers = requires(const X& s, std::size_t i) {
    { s.size() } -> std::same_as<std::size_t>;
    { s.capacity() } -> std::same_as<std::size_t>;
    { s.empty() } -> std::same_as<bool>;
    { s.c_str() } -> std::same_as<const char*>;
    { s[i] } -> std::same_as<const char&>;
};
template <class X> concept HasMutableIndex = requires(X& s, std::size_t i) {
    { s[i] } -> std::same_as<char&>;
};
template <class X> concept HasAppend = requires(X& s, const X& o, const char* p, char c) {
    s.push_back(c);
    { s.append(p) } -> std::same_as<X&>;
    { s.append(o) } -> std::same_as<X&>;
    { s += o } -> std::same_as<X&>;
    { s += c } -> std::same_as<X&>;
};
template <class X> concept HasCapacityOps = requires(X& s, std::size_t n) {
    s.reserve(n);
    s.clear();
};
template <class X> concept HasSubstrFind = requires(const X& s, const X& o, std::size_t n) {
    { s.substr(n, n) } -> std::same_as<X>;
    { s.substr(n) } -> std::same_as<X>;
    { s.find(o, n) } -> std::same_as<std::size_t>;
    { s.find(o) } -> std::same_as<std::size_t>;
};
template <class X> concept HasCompare = requires(const X& a, const X& b) {
    { a == b } -> std::convertible_to<bool>;
    { a != b } -> std::convertible_to<bool>;
    { a < b } -> std::convertible_to<bool>;
};
template <class X> concept HasNpos = requires {
    requires std::same_as<std::remove_cv_t<decltype(X::npos)>, std::size_t>;
    requires X::npos == static_cast<std::size_t>(-1);
};

static_assert(std::is_nothrow_default_constructible_v<S>,
              "String() must exist and be noexcept (an empty String allocates nothing)");
static_assert(std::is_constructible_v<S, const char*>, "String needs a constructor String(const char* s)");
static_assert(std::is_constructible_v<S, std::size_t, char>,
              "String needs a constructor String(std::size_t count, char ch)");
static_assert(std::is_copy_constructible_v<S>, "String needs a copy constructor");
static_assert(std::is_copy_assignable_v<S>, "String needs a copy assignment operator");
static_assert(std::is_nothrow_move_constructible_v<S>, "String(String&&) must exist and be noexcept");
static_assert(std::is_nothrow_move_assignable_v<S>, "String::operator=(String&&) must exist and be noexcept");
static_assert(HasObservers<S>,
              "String needs `std::size_t size() const`, `std::size_t capacity() const`, `bool empty() const`, "
              "`const char* c_str() const` and `const char& operator[](std::size_t) const`");
static_assert(HasMutableIndex<S>, "String needs `char& operator[](std::size_t)`");
static_assert(HasAppend<S>,
              "String needs `void push_back(char)`, `String& append(const char*)`, `String& append(const String&)`, "
              "`String& operator+=(const String&)` and `String& operator+=(char)`");
static_assert(HasCapacityOps<S>, "String needs `void reserve(std::size_t)` and `void clear()`");
static_assert(HasNpos<S>, "String needs `static constexpr std::size_t npos = static_cast<std::size_t>(-1);`");
static_assert(HasSubstrFind<S>,
              "String needs `String substr(std::size_t pos = 0, std::size_t count = npos) const` and "
              "`std::size_t find(const String& needle, std::size_t pos = 0) const`");
static_assert(HasCompare<S>,
              "String needs `operator==` and `operator<` (or `operator<=>`) comparing two Strings");

}  // namespace ipp_harness_str

// Replacements for the global allocation functions (counted while the candidate's code runs).
void* operator new(std::size_t n) { return ipp_harness_str::allocate(n); }
void* operator new[](std::size_t n) { return ipp_harness_str::allocate(n); }
void* operator new(std::size_t n, const std::nothrow_t&) noexcept {
    try {
        return ipp_harness_str::allocate(n);
    } catch (...) {
        return nullptr;
    }
}
void* operator new[](std::size_t n, const std::nothrow_t&) noexcept {
    try {
        return ipp_harness_str::allocate(n);
    } catch (...) {
        return nullptr;
    }
}
void operator delete(void* p) noexcept { ipp_harness_str::deallocate(p); }
void operator delete[](void* p) noexcept { ipp_harness_str::deallocate(p); }
void operator delete(void* p, std::size_t) noexcept { ipp_harness_str::deallocate(p); }
void operator delete[](void* p, std::size_t) noexcept { ipp_harness_str::deallocate(p); }
void operator delete(void* p, const std::nothrow_t&) noexcept { ipp_harness_str::deallocate(p); }
void operator delete[](void* p, const std::nothrow_t&) noexcept { ipp_harness_str::deallocate(p); }

class StringHarness {
    using S = ipp_harness_str::S;
    using Op = ipp_harness_str::Op;
    using Pause = ipp_harness_str::Pause;
    static constexpr int kSlots = 4;
    std::optional<S> slots_[kSlots];

    static void error(const std::string& e) {
        Pause p;
        ipp_harness_str::errs().add(e);
    }
    std::optional<S>& slot(int s) {
        if (s < 0 || s >= kSlots) throw std::invalid_argument("test error: no slot " + std::to_string(s));
        return slots_[s];
    }
    S& held(int s) {
        auto& o = slot(s);
        if (!o) throw std::invalid_argument("test error: slot " + std::to_string(s) + " holds no String");
        return *o;
    }
    static std::size_t sizeOf(const S& v) {
        Op op;
        return v.size();
    }
    // A character as the tests show it: '\0' as '_', other bytes outside printable ASCII as '?'.
    static char shown(char c) {
        unsigned char u = static_cast<unsigned char>(c);
        if (u == 0) return '_';
        return (u < 0x20 || u > 0x7e) ? '?' : c;
    }
    // Checks the invariants every String must keep and returns its characters as shown.
    static std::string render(const S& v, const char* what) {
        const char* p;
        std::size_t n, cap;
        {
            Op op;
            p = v.c_str();
            n = v.size();
            cap = v.capacity();
        }
        Pause g;
        std::string w(what);
        if (!p) {
            ipp_harness_str::errs().add(w + ": c_str() returned nullptr; an empty String must still return \"\"");
            return {};
        }
        if (n > cap) {
            ipp_harness_str::errs().add(w + ": size() is greater than capacity()");
            return "?";
        }
        if (cap > 0) {
            std::size_t i = ipp_harness_str::g_live.find(p);
            if (i == ipp_harness_str::PtrTable::kCap) {
                ipp_harness_str::errs().add(
                    w + ": capacity() > 0 but c_str() is not the start of a live heap buffer allocated by String "
                        "(freed, or not from new[])");
                return "?";
            }
            if (ipp_harness_str::g_live.sizes[i] < cap + 1) {
                ipp_harness_str::errs().add(
                    w + ": the buffer is smaller than capacity() + 1 bytes: it needs room for capacity() "
                        "characters plus the terminating '\\0'");
                return "?";
            }
        }
        std::string out;
        out.reserve(n);
        for (std::size_t k = 0; k < n; ++k) {
            const char* q;
            {
                Op op;
                q = &v[k];
            }
            if (q != p + k) {
                ipp_harness_str::errs().add(w + ": operator[](i) const is not c_str()[i]");
                break;
            }
            out.push_back(shown(p[k]));
        }
        if (p[n] != '\0')
            ipp_harness_str::errs().add(w + ": c_str() is not null-terminated: c_str()[size()] must be '\\0'");
        return out;
    }

public:
    StringHarness() {
        {
            Pause p;
            ipp_harness_str::errs().list.clear();
        }
        ipp_harness_str::resetHeap();
    }
    ~StringHarness() {
        Op op;
        for (auto& o : slots_) o.reset();
    }
    StringHarness(const StringHarness&) = delete;
    StringHarness& operator=(const StringHarness&) = delete;

    // slots[s].emplace(text.c_str())   (an existing String in the slot is destroyed first)
    void create(int s, const std::string& text) {
        auto& o = slot(s);
        Op op;
        o.emplace(text.c_str());
    }

    // slots[s].emplace()
    void createEmpty(int s) {
        auto& o = slot(s);
        Op op;
        o.emplace();
    }

    // slots[s].emplace(std::size_t(count), ch)
    void createFill(int s, int count, char ch) {
        auto& o = slot(s);
        Op op;
        o.emplace(static_cast<std::size_t>(count), ch);
    }

    // slots[s]->push_back(ch)
    void pushBack(int s, char ch) {
        S& v = held(s);
        Op op;
        v.push_back(ch);
    }

    // *slots[s] += '\0'
    void pushNul(int s) {
        S& v = held(s);
        S* r;
        {
            Op op;
            r = &(v += '\0');
        }
        if (r != &v) error("operator+=(char) must return *this");
    }

    // slots[s]->append(text.c_str())
    void append(int s, const std::string& text) {
        S& v = held(s);
        S* r;
        {
            Op op;
            r = &v.append(text.c_str());
        }
        if (r != &v) error("append(const char*) must return *this");
    }

    // slots[to]->append(*slots[from])   (from may equal to)
    void appendString(int from, int to) {
        S& src = held(from);
        S& dst = held(to);
        S* r;
        {
            Op op;
            r = &dst.append(src);
        }
        if (r != &dst) error("append(const String&) must return *this");
    }

    // slots[s]->append(slots[s]->c_str() + pos)   (the argument points into the String itself)
    void appendSuffix(int s, int pos) {
        S& v = held(s);
        if (pos < 0 || std::size_t(pos) > sizeOf(v)) throw std::logic_error("index " + std::to_string(pos) + " is past size() = " + std::to_string(sizeOf(v)) + ": the tests only use valid positions, so size() looks wrong");
        S* r;
        {
            Op op;
            r = &v.append(v.c_str() + pos);
        }
        if (r != &v) error("append(const char*) must return *this");
    }

    // *slots[to] += *slots[from]   (from may equal to)
    void plusEquals(int from, int to) {
        S& src = held(from);
        S& dst = held(to);
        S* r;
        {
            Op op;
            r = &(dst += src);
        }
        if (r != &dst) error("operator+=(const String&) must return *this");
    }

    // slots[s]->reserve(n)
    void reserve(int s, int n) {
        S& v = held(s);
        Op op;
        v.reserve(static_cast<std::size_t>(n));
    }

    // slots[s]->clear()
    void clear(int s) {
        S& v = held(s);
        Op op;
        v.clear();
    }

    // slots[s]->size()   (also checks empty())
    int size(int s) {
        const S& v = held(s);
        Op op;
        std::size_t n = v.size();
        if (v.empty() != (n == 0)) error("empty() disagrees with size()");
        return static_cast<int>(n);
    }

    // slots[s]->capacity()
    int capacity(int s) {
        const S& v = held(s);
        Op op;
        return static_cast<int>(v.capacity());
    }

    // the characters c_str()[0 .. size()), with '\0' shown as '_'; checks the terminator
    std::string str(int s) { return render(held(s), "str"); }

    // (*slots[s])[i], shown like str()
    std::string charAt(int s, int i) {
        const S& v = held(s);
        if (i < 0 || std::size_t(i) >= sizeOf(v)) throw std::logic_error("index " + std::to_string(i) + " is not below size() = " + std::to_string(sizeOf(v)) + ": the tests only use valid indices, so size() looks wrong");
        char c;
        {
            Op op;
            c = v[static_cast<std::size_t>(i)];
        }
        Pause g;
        return std::string(1, shown(c));
    }

    // (*slots[s])[i] = ch
    void setChar(int s, int i, char ch) {
        S& v = held(s);
        if (i < 0 || std::size_t(i) >= sizeOf(v)) throw std::logic_error("index " + std::to_string(i) + " is not below size() = " + std::to_string(sizeOf(v)) + ": the tests only use valid indices, so size() looks wrong");
        Op op;
        v[static_cast<std::size_t>(i)] = ch;
    }

    // slots[to].emplace(*slots[from])   (from != to)
    void copyConstruct(int from, int to) {
        if (from == to) throw std::invalid_argument("test error: copyConstruct needs two slots");
        S& src = held(from);
        auto& dst = slot(to);
        Op op;
        dst.emplace(src);
    }

    // *slots[to] = *slots[from]   (from may equal to)
    void copyAssign(int from, int to) {
        S& src = held(from);
        S& dst = held(to);
        Op op;
        dst = src;
    }

    // slots[to].emplace(std::move(*slots[from]))   (from != to)
    void moveConstruct(int from, int to) {
        if (from == to) throw std::invalid_argument("test error: moveConstruct needs two slots");
        S& src = held(from);
        auto& dst = slot(to);
        Op op;
        dst.emplace(std::move(src));
    }

    // *slots[to] = std::move(*slots[from])   (from may equal to)
    void moveAssign(int from, int to) {
        S& src = held(from);
        S& dst = held(to);
        Op op;
        dst = std::move(src);
    }

    // destroys the String in slot s; the slot becomes empty
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

    // -1 if *slots[a] < *slots[b], 1 if *slots[b] < *slots[a], else 0 (also checks == and !=)
    int compare(int a, int b) {
        const S& x = held(a);
        const S& y = held(b);
        bool lt, gt, eq, ne;
        {
            Op op;
            lt = x < y;
            gt = y < x;
            eq = x == y;
            ne = x != y;
        }
        if (lt && gt) error("operator<: a < b and b < a are both true");
        if (eq == ne) error("operator!= is not the negation of operator==");
        if (eq != (!lt && !gt)) error("operator== disagrees with operator<: equal Strings are neither less nor greater");
        return lt ? -1 : gt ? 1 : 0;
    }

    // slots[s]->substr(pos, count) shown like str(), or "!out_of_range" if it throws
    // std::out_of_range (count = -1 is npos: it is converted to std::size_t)
    std::string substr(int s, int pos, int count) {
        const S& v = held(s);
        std::optional<S> r;
        long before = ipp_harness_str::g_allocations;
        try {
            Op op;
            r.emplace(v.substr(static_cast<std::size_t>(pos), static_cast<std::size_t>(count)));
        } catch (const std::out_of_range&) {
            // The exception's message may be heap-allocated; that is not a String buffer.
            ipp_harness_str::g_allocations = before;
            Pause g;
            return "!out_of_range";
        }
        std::string out = render(*r, "substr");
        Op op;
        r.reset();
        return out;
    }

    // slots[a]->find(*slots[b], pos), or -1 for npos
    int find(int a, int b, int pos) {
        const S& hay = held(a);
        const S& needle = held(b);
        std::size_t r;
        {
            Op op;
            r = hay.find(needle, static_cast<std::size_t>(pos));
        }
        if (r == S::npos) return -1;
        return static_cast<int>(r);
    }

    // heap allocations made by String operations so far in this test
    int allocations() { return static_cast<int>(ipp_harness_str::g_allocations); }

    // heap blocks allocated by String operations and not yet freed
    int heapBlocks() { return static_cast<int>(ipp_harness_str::g_live.count); }

    // problems the harness detected; [] when all is well
    std::vector<std::string> errors() {
        Pause p;
        std::vector<std::string> e = ipp_harness_str::errs().list;
        long overruns = ipp_harness_str::g_overruns;
        ipp_harness_str::g_live.each([&](void* q, std::size_t n) {
            if (!ipp_harness_str::guardIntact(q, n)) ++overruns;
        });
        if (overruns)
            e.push_back("a write past the end of a heap buffer (is there room for the terminating '\\0'?)");
        if (ipp_harness_str::g_doubleFrees)
            e.push_back(std::to_string(ipp_harness_str::g_doubleFrees) + " buffer(s) freed twice");
        if (ipp_harness_str::g_overflow) e.push_back("harness: too many heap allocations to track");
        return e;
    }
};
