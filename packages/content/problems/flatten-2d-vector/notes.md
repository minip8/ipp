**Approaches**
- Flatten everything in the constructor into one array plus an index. Trivial, O(total) memory and constructor time; the statement forbids it, but it is a fine first sentence. Ask why it is undesirable (huge or lazy inputs, iterator should be cheap to create).
- Expected: two indices `(row, col)`. A helper `advance()` skips forward while `row < rows` and `col == vec[row].size()` (moving to the next row with `col = 0`). `hasNext` calls `advance()` and checks `row < rows`; `next` calls `advance()` and returns `vec[row][col++]`. Amortised O(1) per call, O(1) extra memory.
- C++ idiom: hold the outer vector by reference/copy and two iterators (outer, inner) — discuss iterator invalidation if the underlying vector were modified.

**Common wrong turns**
- Not skipping *consecutive* empty rows (an `if` instead of a `while`) — test `h-many-empty`.
- Skipping empty rows only in `next` but not in `hasNext`, so `hasNext` returns true at the end when trailing rows are empty.
- `hasNext` that advances past an element (calling it twice in a row loses elements) — test `h-hasnext-idempotent`.
- Empty outer vector, or only empty rows: `hasNext` must be false immediately, not crash.

**Hint ladder**
1. What is the minimum state you need to know where you are?
2. Two indices: row and column. When is that position not pointing at a real element?
3. Write one helper that moves the position forward until it points at a real element or past the end.
4. Call that helper at the start of both `next` and `hasNext`; it must be safe to call repeatedly.

**Follow-ups**
- Add `remove()` that deletes the last element returned (Java `Iterator` contract) — implications for indices.
- Generalise to arbitrarily nested lists (stack of iterators) — LeetCode 341 "Flatten Nested List Iterator".
- Peeking iterator wrapper; zigzag iterator over k lists.
- Make it a proper C++ forward iterator (`operator*`, `operator++`, `operator==`) usable in range-for; what does the end iterator look like?
