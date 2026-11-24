import java.util.*;

class Solution {
    private char[][] g;
    private final int[] rows = new int[9], cols = new int[9], boxes = new int[9];
    private int[] er, ec;  // empty cells
    private int ne;

    public String[] solveSudoku(String[] board) {
        g = new char[9][];
        er = new int[81];
        ec = new int[81];
        ne = 0;
        for (int r = 0; r < 9; r++) {
            g[r] = board[r].toCharArray();
            for (int c = 0; c < 9; c++) {
                if (g[r][c] == '.') {
                    er[ne] = r;
                    ec[ne++] = c;
                } else {
                    int bit = 1 << (g[r][c] - '1');
                    rows[r] |= bit;
                    cols[c] |= bit;
                    boxes[r / 3 * 3 + c / 3] |= bit;
                }
            }
        }
        solve();
        String[] out = new String[9];
        for (int r = 0; r < 9; r++) out[r] = new String(g[r]);
        return out;
    }

    private boolean solve() {
        if (ne == 0) return true;
        int bestI = -1, bestMask = 0, bestCnt = 10;
        for (int i = 0; i < ne; i++) {
            int r = er[i], c = ec[i];
            int mask = ~(rows[r] | cols[c] | boxes[r / 3 * 3 + c / 3]) & 0x1FF;
            int cnt = Integer.bitCount(mask);
            if (cnt < bestCnt) {
                bestI = i;
                bestMask = mask;
                bestCnt = cnt;
                if (cnt <= 1) break;
            }
        }
        if (bestCnt == 0) return false;
        int r = er[bestI], c = ec[bestI], b = r / 3 * 3 + c / 3;
        ne--;
        er[bestI] = er[ne];
        ec[bestI] = ec[ne];
        for (int mask = bestMask; mask != 0; mask &= mask - 1) {
            int bit = mask & -mask;
            rows[r] |= bit;
            cols[c] |= bit;
            boxes[b] |= bit;
            if (solve()) {
                g[r][c] = (char) ('1' + Integer.numberOfTrailingZeros(bit));
                return true;
            }
            rows[r] ^= bit;
            cols[c] ^= bit;
            boxes[b] ^= bit;
        }
        er[ne] = er[bestI];
        ec[ne] = ec[bestI];
        er[bestI] = r;
        ec[bestI] = c;
        ne++;
        return false;
    }
}

public class Main {
    public static void main(String[] args) {
        String[] p = { "5..3.64..", ".8.......", "63.74852.", "9..1..863", ".6348...9", ".7....254", "..4.6..7.", "7.6...982", "3.....1.." };
        for (String row : new Solution().solveSudoku(p)) System.out.println(row);
    }
}
