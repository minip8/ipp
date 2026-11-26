Implement `String`, a growable byte string that owns a heap buffer (a subset of `std::string`). The interesting parts are **ownership** (the rule of five over a raw `char` buffer), **growth** (amortised O(1) appends with geometric reallocation) and the **terminating `'\0'`** that `c_str()` must always provide, including for an empty string that owns no memory at all.

Do not use `std::string`, `std::vector` or other containers inside your class; the `<cstring>` functions (`std::memcpy`, `std::strlen`, ...) are fine. There is no small-string optimisation here: every character lives in the heap buffer. Define everything at global scope (no namespace).

**Required interface**

```cpp
class String {
public:
    static constexpr std::size_t npos = static_cast<std::size_t>(-1);

    String() noexcept;                          // "", capacity 0, allocates nothing
    String(const char* s);                      // copies the C string s (never null)
    String(std::size_t count, char ch);         // count copies of ch
    String(const String& other);
    String& operator=(const String& other);
    String(String&& other) noexcept;
    String& operator=(String&& other) noexcept;
    ~String();

    std::size_t size() const;
    std::size_t capacity() const;
    bool empty() const;
    const char* c_str() const;
    char& operator[](std::size_t i);            // i < size()
    const char& operator[](std::size_t i) const;

    void push_back(char c);
    String& append(const char* s);              // returns *this
    String& append(const String& s);
    String& operator+=(const String& s);
    String& operator+=(char c);
    void reserve(std::size_t n);
    void clear();

    String substr(std::size_t pos = 0, std::size_t count = npos) const;
    std::size_t find(const String& needle, std::size_t pos = 0) const;
};

bool operator==(const String& a, const String& b);   // and operator< (or operator<=>)
```

**Behaviour**

- **Buffer**: a `String` with `capacity() == 0` owns no memory. One with `capacity() > 0` owns exactly one heap block of `capacity() + 1` bytes, from `new char[]` (or `::operator new`), and `c_str()` returns its start. The first `size()` bytes are the characters and `c_str()[size()]` is `'\0'`, after every operation. `c_str()` never returns `nullptr`: for a `String` without a buffer it returns `""`.
- **Construction** allocates exactly what it needs: `String(s)` has capacity `strlen(s)`, `String(count, ch)` capacity `count`, and the copy constructor capacity `other.size()` (not `other.capacity()`). None of them allocates when the result is empty.
- **Growth**: when `push_back`, `append` or `+=` needs room for `size() + n` characters and that exceeds `capacity()`, the string allocates a new buffer with capacity `max(2 * capacity(), size() + n)`, copies the characters over and frees the old buffer: one allocation. Otherwise nothing is allocated (appending `""` never allocates).
- `reserve(n)` reallocates to exactly `n` if `n > capacity()` and does nothing otherwise (it never shrinks). `clear()` makes the size `0` but keeps the buffer and the capacity.
- **Embedded `'\0'`**: a `String` may contain `'\0'` characters (`push_back('\0')`); `size()` counts them. Copying, `append(const String&)`, `+=`, comparison, `find` and `substr` work on all `size()` characters, so they cannot use `strlen`, `strcpy` or `strcmp`. `String(const char*)` and `append(const char*)` take a C string, which ends at its first `'\0'`.
- **Aliasing**: `s.append(s)`, `s += s` and `s.append(s.c_str() + k)` must work, even when they reallocate.
- **Copy assignment**: afterwards the target holds its own copy of `other`'s characters. Its capacity afterwards is up to you (reusing a large enough buffer, as `std::string` does, or copy-and-swap: both are fine). `s = s` leaves `s` unchanged.
- **Move constructor / move assignment**: take over `other`'s buffer without allocating or copying characters (move assignment first frees the target's own buffer). `other` is left empty with capacity `0`, owning nothing, and remains usable. `s = std::move(s)` leaves `s` unchanged.
- `substr(pos, count)` throws `std::out_of_range` if `pos > size()`. Otherwise it returns a new `String` of the `min(count, size() - pos)` characters starting at `pos`, with capacity equal to its size: one allocation, none if it is empty. (`count` may be `npos` or any other huge value: beware of `pos + count` overflowing.)
- `find(needle, pos)` returns the smallest `i >= pos` at which `needle` occurs, or `npos`. An empty `needle` is found at `pos` if `pos <= size()`.
- **Comparison**: `a == b` if they have the same characters. `a < b` is lexicographic order comparing characters as `unsigned char` (like `std::memcmp`); a proper prefix is less than the longer string. `!=` must work too (in C++20 it is generated from `==`).

The `noexcept` requirements and the required members are checked at compile time; a mismatch is a compile error that says what is wrong.

**How the tests work**

A hidden harness has **four slots** (`0`..`3`), each either empty or holding one `String`. It replaces the global `operator new` and `operator delete` so it can see your buffers: it counts the blocks you allocate and free, fills a fresh block with garbage (so a missing `'\0'` shows), notices a write past the end of a block or a block freed twice, and checks after reading a string that `c_str()` points to a live buffer of at least `capacity() + 1` bytes. Each test call performs one C++ operation:

| Test call | What the harness does |
|---|---|
| `create(s, text)` | `slots[s].emplace(text.c_str())` (any `String` already in slot `s` is destroyed first) |
| `createEmpty(s)` | `slots[s].emplace()` |
| `createFill(s, n, ch)` | `slots[s].emplace(std::size_t(n), ch)` |
| `pushBack(s, ch)` | `slots[s]->push_back(ch)` |
| `pushNul(s)` | `*slots[s] += '\0'` |
| `append(s, text)` | `slots[s]->append(text.c_str())` |
| `appendString(a, b)` | `slots[b]->append(*slots[a])` (`a` may equal `b`) |
| `appendSuffix(s, k)` | `slots[s]->append(slots[s]->c_str() + k)` (the argument points into the string itself) |
| `plusEquals(a, b)` | `*slots[b] += *slots[a]` (`a` may equal `b`) |
| `reserve(s, n)`, `clear(s)` | `slots[s]->reserve(n)`, `slots[s]->clear()` |
| `size(s)`, `capacity(s)` | `slots[s]->size()` (also checks `empty()`), `slots[s]->capacity()` |
| `str(s)` | the characters `c_str()[0 .. size())`, each `'\0'` shown as `_` (also checks the terminator, the buffer and `operator[] const`) |
| `charAt(s, i)`, `setChar(s, i, ch)` | `(*slots[s])[i]` (shown like `str`), `(*slots[s])[i] = ch` |
| `copyConstruct(a, b)` | `slots[b].emplace(*slots[a])` (`a != b`) |
| `copyAssign(a, b)` | `*slots[b] = *slots[a]` (`a` may equal `b`) |
| `moveConstruct(a, b)` | `slots[b].emplace(std::move(*slots[a]))` (`a != b`) |
| `moveAssign(a, b)` | `*slots[b] = std::move(*slots[a])` (`a` may equal `b`) |
| `destroy(s)`, `destroyAll()` | destroy the `String` in slot `s` / in every slot, in slot order |
| `compare(a, b)` | `-1` if `*slots[a] < *slots[b]`, `1` if `*slots[b] < *slots[a]`, else `0` (also checks `==` and `!=` agree) |
| `substr(s, pos, n)` | `slots[s]->substr(pos, n)` shown like `str`, or `"!out_of_range"` if it throws `std::out_of_range` (`n = -1` is `npos`: it is converted to `std::size_t`) |
| `find(a, b, pos)` | `slots[a]->find(*slots[b], pos)`, or `-1` for `npos` |
| `allocations()` | the number of heap allocations made by `String` operations so far in this test |
| `heapBlocks()` | heap blocks allocated by your code and not yet freed |
| `errors()` | problems the harness detected (a missing terminator, a buffer too small or already freed, a write past the end, a block freed twice, `==` and `<` disagreeing); `[]` when everything is correct |

Most tests end with `destroyAll()`, `heapBlocks()` (expected `0`: nothing leaked) and `errors()` (expected `[]`).

**Example**

```
createEmpty(0)
capacity(0)     -> 0
str(0)          -> ""     c_str() is "" without any buffer
allocations()   -> 0
pushBack(0, 'a')          capacity 0 -> 1
pushBack(0, 'b')          capacity 1 -> 2
pushBack(0, 'c')          capacity 2 -> 4
append(0, "defgh")        needs 8 > 4: capacity max(2 * 4, 8) = 8
pushBack(0, 'i')          needs 9 > 8: capacity max(2 * 8, 9) = 16
capacity(0)     -> 16
str(0)          -> "abcdefghi"
allocations()   -> 5
copyConstruct(0, 1)
capacity(1)     -> 9      a copy allocates exactly size() characters
moveConstruct(1, 2)       takes the buffer: no allocation
capacity(1)     -> 0      the moved-from String is "" and owns nothing
allocations()   -> 6
```

**Constraints**

- C++23 (GCC). At most `1500` calls per test; strings hold at most about 11000 characters, and test text uses only lowercase letters and digits.
