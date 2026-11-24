**Approaches**
- Plain string + index: insert/delete in the middle of the string copy the tail, O(L) per call. Correct; with 2*10^4 calls and documents up to ~8*10^5 characters it is too slow in Python and wasteful in C++. Good first statement.
- Expected — two stacks (a gap buffer in disguise): `left` holds the characters before the cursor in order, `right` holds the characters after the cursor in **reverse** order (so its top is the character just after the cursor). `addText` pushes onto `left`; `deleteText` pops from `left`; moving the cursor pops from one stack and pushes onto the other. The return string is the last ≤10 entries of `left`. O(k + |text|) per call. In C++ two `std::string`s (or `vector<char>`) used as stacks; in Python two lists.
- Doubly linked list of characters with a cursor node: also O(k) per call, but each move walks nodes and memory overhead is large. Acceptable; ask about cache behaviour.
- Gap buffer: one array with a movable gap at the cursor — what real editors (Emacs) use. Two stacks *are* a gap buffer split into two arrays. Ropes / piece tables for huge files and undo.

**Common wrong turns**
- Returning the characters to the left of the *old* cursor position instead of the new one.
- Returning more than 10 characters, or the 10 characters in reverse order (when reading from a reversed stack).
- Not clamping `k`: moving past either end, or deleting more than exists.
- `deleteText` deleting to the right of the cursor.
- Building the return value from the entire left part each time (`s[:p][-10:]` in Python slices O(p)).

**Hint ladder**
1. What part of the text actually changes on each operation?
2. All edits happen at the cursor. What structure makes adding and removing at one point cheap?
3. Split the text at the cursor into two stacks: what comes before, and what comes after (stored reversed).
4. Moving the cursor is just transferring characters from the top of one stack to the top of the other.

**Follow-ups**
- Undo/redo (command pattern; store inverse operations).
- Very large files (gigabytes): ropes, piece tables (VS Code), memory-mapped originals.
- Multiple cursors; line/column addressing; search.
- Unicode: what breaks if the text is UTF-8 and the cursor moves by bytes?
