**What this is testing**
Resource ownership over a raw buffer (the rule of five, self-assignment, moved-from state), amortised growth, and the details that make a C++ string a string rather than a `vector<char>`: the terminating `'\0'` that must always be there (including for an empty string that owns nothing), the `+1` in every allocation, embedded `'\0'` characters, and aliasing (`s.append(s)`). It is smaller than `vector` (no element lifetimes: `char` is trivial), so the signal is in precision. A strong candidate finishes the core in 25-30 minutes and has time for small-string optimisation as a follow-up.

**Approaches**
- Expected: members `char* data_`, `size_t size_`, `size_t cap_`, with the invariant "`data_` is null iff `cap_ == 0`, otherwise it holds `cap_ + 1` bytes and `data_[size_] == '\0'`". `c_str()` returns `data_ ? data_ : ""`; a static `char` for the empty state also works.
- A private "construct from (pointer, length)" helper gives the copy constructor, `String(const char*)`, `String(n, ch)` and `substr` one exact allocation each.
- A single `append(const char* p, size_t n)` core used by `push_back`, both `append`s and `+=`: if `n > cap_ - size_` (written that way, no overflow), allocate `max(2 * cap_, size_ + n)`, copy the old characters *and* `p` into the new buffer, then free the old one. Doing it in that order is what makes `s.append(s)` work.
- Copy assignment: the reference reuses the buffer when `other.size() <= capacity()` (what `std::string` does: no allocation) and falls back to copy-and-swap otherwise. Plain copy-and-swap is also accepted; ask what it costs in a loop that reassigns a string of similar length (an allocation and a free every time).
- Move operations: `std::exchange` the three members; move assignment by move-and-swap with a self check. All `noexcept`.
- Comparison with `memcmp` over `min(size)` then by size; `operator<=>` returning `std::strong_ordering` is a nice touch in C++20 (it gives `<`, `>`, `<=`, `>=`).

**Common wrong turns**
- Allocating one byte in the default constructor so `c_str()` has something to point at: correct output, but an allocation for every empty string, and a `noexcept` default constructor that can now hit `std::bad_alloc` (which would call `std::terminate`). Returning `data_` from `c_str()` when it is null: callers crash on `strlen(s.c_str())`.
- `new char[cap]` instead of `new char[cap + 1]`: writing the terminator overruns the buffer (harness: "the buffer is smaller than capacity() + 1 bytes" or "a write past the end").
- Forgetting to write `'\0'` after `clear()`, `push_back` or a reallocation. The harness fills fresh blocks with garbage, so it shows immediately.
- `strlen`/`strcpy`/`strcmp` in the copy constructor, `append(const String&)` or comparisons: works until the string contains a `'\0'` (`h-embedded-nul`). Ask why `std::string` stores its size instead of relying on the terminator.
- Growth `cap + 1` or `cap + 16`: quadratic copying over many appends. Ask for the amortised argument for doubling (total copying is at most 2N for N appends). `cap * 2` alone stays at 0 from an empty string and is too small for a long append.
- `s.append(s)` that frees the old buffer first and then copies from it (reads freed memory; the harness scribbles over freed blocks so the result is garbage).
- Copy constructor copying the pointer (shallow copy): double free, and a write through one string shows in the other.
- Copy assignment `delete[] data_; ...copy from other...` without a self check: `s = s` reads freed memory. Move assignment that frees first without a self check: `s = std::move(s)` loses the contents.
- Move constructor that copies the pointer but leaves the source owning it (double free), or that copies the characters (an allocation; not a move).
- `substr` computing `pos + count > size()`: with `count == npos` the sum wraps and the clamp is skipped. `find` computing `size() - needle.size()` when the needle is longer: wraps to a huge bound and reads past the end.
- `clear()` freeing the buffer (capacity must stay), `reserve(n)` shrinking when `n < capacity()`.

**Hint ladder**
1. What must `c_str()` return for a `String` that has never had any characters? Does that require owning memory?
2. How many bytes does a buffer for `capacity()` characters need?
3. Where does `size()` come from if the string can contain `'\0'`? Which `<cstring>` functions are still safe?
4. In `s.append(s)`, the argument points into your own buffer. When is the old buffer safe to free?
5. What does the compiler-generated copy constructor do with `data_`, and what happens at destruction?

**Follow-ups**
- Small-string optimisation: store up to ~15 characters inside the object (a union of the heap pointer and capacity with an inline array; libstdc++ uses 15 chars in a 32-byte string, libc++ 22 in 24 bytes with a flag bit). What does SSO do to the cost of a move (now it copies the inline characters), to `capacity()` of an empty string, and to iterator/pointer stability on move? Why did libstdc++'s old copy-on-write string have to go in C++11 (`operator[]` and thread safety, `c_str()` invalidation rules)?
- Exception safety of each operation: which give the strong guarantee here? (Growth allocates before touching the old buffer, so a `std::bad_alloc` leaves the string unchanged.)
- `std::string_view`: what would `find` and `append` look like taking a `string_view`, and what lifetime bug does `string_view` make easy (a view of a temporary)?
- `operator+` for two strings: return by value, `String operator+(String a, const String& b) { a += b; return a; }` and why taking the left operand by value helps chains like `a + b + c`.
- `shrink_to_fit`, `resize(n, ch)`, `insert`/`erase` in the middle (memmove), and why `std::string::find` is usually not KMP (short needles; a `memchr` for the first character is faster in practice).
- Growth factor 2 vs 1.5 (with 1.5 a later allocation can reuse the sum of the freed earlier blocks).
