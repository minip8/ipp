**Rule check (not enforced by tests)**
- The elements must live in nodes with `prev`/`next` links that the candidate allocates. Read the code: `std::list`, `LinkedList`, `collections.deque`, or a Python list/array doing the work means the exercise was skipped, and a list hidden behind the interface would pass every test (the tests cannot see the links, only what `toArray`/`toArrayReversed` return). An index-based node pool (parallel `prev`/`next` arrays) is a legitimate design; accept it and discuss it.
- Collecting values into an array in `toArray`/`toArrayReversed` is fine.
- `reverse` must relink nodes; copying the values out and writing them back reversed is not what was asked, even though it passes.

**Approaches**
- Expected: nodes `{val, prev, next}`, plus either `head`/`tail` pointers (with null ends) or a single sentinel node in a circle (`sent.next` is the front, `sent.prev` the back). The sentinel removes every special case: insert is always "link before node X", erase is always "splice X out". Push/pop/front/back/size O(1); get/insert/erase O(min(i, n - i)) walking from the nearer end; reverse O(n), O(1) extra (swap `prev`/`next` on every node, then swap head and tail — with a sentinel, swap on the sentinel too).
- Keeping a `size` counter is what makes `size()` O(1), the bounds checks cheap and the nearer-end choice possible.

**Common wrong turns**
- Forgetting the `prev` pointer of the old head on `pushFront`, or of the new neighbour on erase: `toArray` still looks right, `toArrayReversed` does not. Most hidden tests read both directions.
- Removing the last remaining node from one end and not resetting the other end pointer (`tail` still points at the freed node). `h-single-node`, `h-erase-to-empty`.
- `insert(0, v)` or `insert(size, v)` without updating `head`/`tail`; `insert(size, v)` rejected as out of range.
- Off-by-one walking to a position, especially walking from the back (`n - 1 - i` steps from `tail`). `h-get-every-index`.
- `reverse` that relinks nodes but forgets to swap `head` and `tail`, or swaps `next` only. Edge cases with 0, 1 and 2 nodes. `h-reverse-small`, `h-reverse-then-edit`.
- C++: leaking nodes on erase/pop or in the destructor (not tested; ask). Use-after-free when reading `node->val` after `delete`.
- Java: none specific; Python: recursion in `toArray` overflows the stack on thousands of nodes.

**Hint ladder**
1. What does each node need to know so you can remove it without walking from the front?
2. Write down every pointer that changes when you insert a node between A and B, and when you remove it. Which of A and B can be missing?
3. A sentinel node that is both "before the front" and "after the back" means A and B always exist.
4. For `reverse`, every node's `prev` and `next` swap places; then the front and the back swap. For positions in the back half, walk from the back.

**Follow-ups**
- `splice` a range of one list into another in O(1). Why does `std::list::size()` being O(1) (since C++11) make range `splice` between lists O(n)?
- Iterator invalidation: which `std::list` operations invalidate which iterators, compared with `std::vector`?
- Intrusive lists (the node lives inside the object, as in the Linux kernel): what do they save?
- XOR linked list (one pointer field storing `prev ^ next`): how do you traverse it, and why is it rarely worth it?
- Cache behaviour: why is a linked list usually slower than a vector even for front insertions of small elements? When is it still the right choice (stable references, O(1) splice, LRU caches)?
- O(1) `reverse` with a direction flag: what does every other operation have to do then?
