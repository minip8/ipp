**Approaches**
- Two stacks (back stack, forward stack): visit pushes current onto back and clears forward; back/forward move pages between them one at a time. O(steps) per move, O(forward size) per visit (clear).
- Doubly linked list with a cursor: same costs.
- Expected/best: a single array plus `cur` (current index) and `last` (index of the newest valid entry). `visit` writes at `cur + 1` (overwriting or appending), sets `last = cur + 1`; `back` is `cur = max(0, cur - steps)`; `forward` is `cur = min(last, cur + steps)`. All O(1) (amortised for append). Stale entries beyond `last` are simply ignored, not erased.

**Common wrong turns**
- Forgetting to discard the forward history on `visit` (test `h-visit-truncates`).
- Array version: truncating logically but then letting `forward` run to the physical end of the array instead of `last`.
- Off-by-one clamping on back/forward.
- Treating a visit to the current URL as a no-op.

**Hint ladder**
1. What does the history look like at any moment — what shape is it?
2. It is a line of pages with a cursor. What does `visit` do to the part right of the cursor?
3. Could you store it in one array plus a couple of indices instead of moving pages around?
4. Keep the index of the current page and the index of the last valid page; back/forward just clamp the cursor.

**Follow-ups**
- Cap history at N entries (ring buffer).
- Multiple tabs, closing and reopening tabs ("reopen closed tab" stack).
- Show the full back list for a long-press menu efficiently.
- Persisting history across sessions; memory if URLs are long (intern strings).
