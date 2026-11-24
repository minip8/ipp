import java.util.*;

class Solution {
    private int n;
    private int[] queens;
    private boolean[] cols, diag, anti;
    private List<List<String>> res;

    public List<List<String>> solveNQueens(int size) {
        n = size;
        queens = new int[n];
        cols = new boolean[n];
        diag = new boolean[2 * n - 1];
        anti = new boolean[2 * n - 1];
        res = new ArrayList<>();
        go(0);
        return res;
    }

    private void go(int r) {
        if (r == n) {
            List<String> board = new ArrayList<>();
            for (int c : queens) {
                char[] row = new char[n];
                Arrays.fill(row, '.');
                row[c] = 'Q';
                board.add(new String(row));
            }
            res.add(board);
            return;
        }
        for (int c = 0; c < n; c++) {
            int d = r - c + n - 1, a = r + c;
            if (cols[c] || diag[d] || anti[a]) continue;
            cols[c] = diag[d] = anti[a] = true;
            queens[r] = c;
            go(r + 1);
            cols[c] = diag[d] = anti[a] = false;
        }
    }
}

public class Main {
    public static void main(String[] args) {
        System.out.println(new Solution().solveNQueens(4));
        System.out.println(new Solution().solveNQueens(8).size());
    }
}
