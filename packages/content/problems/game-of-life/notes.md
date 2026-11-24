**Approaches**
- Copy the board, count neighbours in the copy, write results into the original (or a new board). O(m * n) time, O(m * n) extra.
- Expected follow-up: in place with O(1) extra memory by encoding two generations in each cell — e.g. use bit 0 for the current state and bit 1 for the next state (`board[i][j] |= next << 1`), counting neighbours with `& 1`, then shift every cell right by one. Or use sentinel states like 2 = "alive -> dead", 3 = "dead -> alive".
- Only one previous row buffer is needed if you want O(n) extra without bit tricks.

**Common wrong turns**
- Updating cells in place without preserving the old state — later neighbours see the *new* generation (the blinker example breaks).
- Counting the cell itself as its own neighbour.
- Out-of-bounds neighbour access at edges and corners; wrapping around the edges.
- Mis-stating rule 4 (only *exactly* three).

**Hint ladder**
1. Why can't you simply overwrite each cell as you compute it?
2. A cell is 0 or 1 but an int holds many more bits. Could each cell temporarily hold both its old and new state?
3. First pass: compute the new state from the old bit and store it in another bit; second pass: move the new bit into place.

**Follow-ups**
- Infinite board: store only live cells in a hash set and count neighbours from them.
- Very large, sparse, long-running simulations (Hashlife, or bitboards with SIMD).
- Multi-threaded update: what does double buffering buy you?
