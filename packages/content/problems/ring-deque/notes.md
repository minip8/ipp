**Rule check (not enforced by tests)**
- The elements must live in a buffer the candidate manages: `new int[cap]` / `unique_ptr<int[]>` in C++, `int[]` in Java, a preallocated `[0] * cap` list in Python that is only indexed and replaced by a larger block on growth. Read the code: `std::deque`, `collections.deque`, `ArrayDeque`, or a Python list with `insert(0, x)` / `pop(0)` doing the work means the exercise was skipped. Slice copies between two fixed blocks in Python are fine (the equivalent of `memcpy`).
- Returning a built-in list from `toArray` is fine.

**Approaches**
- Expected: buffer, `head` (index of the front), `size`. Position `i` lives at `(head + i) % cap`. `pushFront` decrements `head` with wrap-around; `pushBack` writes at `(head + size) % cap`; pops move `head` or shrink `size`. All O(1); pushes amortised O(1) with geometric growth. O(capacity) space.
- Growth: allocate `2 * cap`, copy the elements in logical order (position 0 to index 0 — "unwrapping"), set `head = 0`. Two `memcpy`s or a loop over positions.
- Power-of-two capacity lets `% cap` become `& (cap - 1)`, which also sidesteps negative modulo.
- Shifting elements on `pushFront` (or an array that only grows at the back) is O(n) per operation; `h-large-both-ends` (five million elements, then 2500 operations, mostly at the front) times out with it, even with `memmove`.
- Alternatives worth discussing: `std::deque`'s real layout (a map of fixed-size blocks, so references stay valid on push at either end); two stacks (amortised, but `get(i)` gets awkward).

**Common wrong turns**
- Growth that copies the raw buffer (`memcpy(nb, buf, cap)`) instead of unwrapping: correct only when `head == 0`. `h-grow-wrapped` and `h-large-push-front` catch it whatever the initial capacity and growth factor.
- Growing when the buffer is full but checking `size == cap - 1` or after writing.
- `pushFront` as `head - 1` without wrapping (index -1 on the first `pushFront`; C++ `%` of a negative is negative, `size_t` underflow). `h-front-wraps-first`.
- `back()` computed as `buf[tail - 1]` without wrapping when `tail == 0`.
- Keeping `head` and `tail` with no count: full and empty look the same.
- `get(i)` returning `buf[i]` instead of `buf[(head + i) % cap]`.
- `resize` growth filling `[size, n)` as raw indices rather than positions, so the fill does not wrap (`h-resize-wrapped-grow`).
- Starting with capacity 0 and doubling: 0 * 2 stays 0.

**Hint ladder**
1. If elements never move, what has to change on a push or pop at each end?
2. Keep the index of the front element and the count; where does position `i` live in the buffer?
3. Wrap every index with modulo (or a mask with a power-of-two capacity). What do you do when the buffer is full?
4. Allocate a buffer twice as big and copy the elements across in order, position 0 first, then reset the front index to 0. Copying the buffer as is breaks the order when it wraps.

**Follow-ups (C++ angle)**
- Why does `std::deque` use a block map rather than a single ring buffer? (Pointer/reference stability on push_front/push_back, no big copies.) What does that cost for random access?
- Make it `RingDeque<T>`: raw storage with placement new, destroying on pop, moving elements on growth (`std::uninitialized_move`), exception safety.
- Shrinking policy: when should it give memory back without thrashing (shrink at a quarter, not at a half)?
- Iterators: what does `end()` look like on a ring buffer, and how do you tell `begin() == end()` apart for full vs empty?
- Lock-free single-producer/single-consumer version with a fixed capacity.
