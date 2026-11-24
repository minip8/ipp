class Solution:
    """Backtracking with bitmasks of used digits per row/column/box, always branching on the
    empty cell with the fewest candidates (minimum remaining values)."""

    def solveSudoku(self, board: list[str]) -> list[str]:
        grid = [list(row) for row in board]
        rows, cols, boxes = [0] * 9, [0] * 9, [0] * 9
        empty = []
        for r in range(9):
            for c in range(9):
                ch = grid[r][c]
                if ch == ".":
                    empty.append((r, c))
                else:
                    bit = 1 << (ord(ch) - 49)
                    rows[r] |= bit; cols[c] |= bit; boxes[r // 3 * 3 + c // 3] |= bit

        def solve() -> bool:
            if not empty:
                return True
            # pick the most constrained empty cell
            best_i, best_mask, best_cnt = -1, 0, 10
            for i, (r, c) in enumerate(empty):
                mask = ~(rows[r] | cols[c] | boxes[r // 3 * 3 + c // 3]) & 0x1FF
                cnt = bin(mask).count("1")
                if cnt < best_cnt:
                    best_i, best_mask, best_cnt = i, mask, cnt
                    if cnt <= 1:
                        break
            if best_cnt == 0:
                return False
            r, c = empty[best_i]
            empty[best_i] = empty[-1]
            empty.pop()
            b = r // 3 * 3 + c // 3
            mask = best_mask
            while mask:
                bit = mask & -mask
                mask ^= bit
                rows[r] |= bit; cols[c] |= bit; boxes[b] |= bit
                if solve():
                    grid[r][c] = str(bit.bit_length())
                    return True
                rows[r] ^= bit; cols[c] ^= bit; boxes[b] ^= bit
            empty.append((r, c))
            empty[best_i], empty[-1] = empty[-1], empty[best_i]
            return False

        solve()
        return ["".join(row) for row in grid]


if __name__ == "__main__":
    puzzle = ["5..3.64..", ".8.......", "63.74852.", "9..1..863", ".6348...9", ".7....254", "..4.6..7.", "7.6...982", "3.....1.."]
    print("\n".join(Solution().solveSudoku(puzzle)))
