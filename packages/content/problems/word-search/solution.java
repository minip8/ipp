import java.util.*;

class Solution {
    private char[][] g;
    private char[] w;
    private int R, C;

    public boolean exist(String[] board, String word) {
        R = board.length;
        C = board[0].length();
        if (word.length() > R * C) return false;
        g = new char[R][];
        int[] have = new int[128], need = new int[128];
        for (int r = 0; r < R; r++) {
            g[r] = board[r].toCharArray();
            for (char ch : g[r]) have[ch]++;
        }
        for (char ch : word.toCharArray()) need[ch]++;
        for (int k = 0; k < 128; k++) if (need[k] > have[k]) return false;
        w = word.toCharArray();
        if (have[w[0]] > have[w[w.length - 1]]) w = new StringBuilder(word).reverse().toString().toCharArray();
        for (int r = 0; r < R; r++)
            for (int c = 0; c < C; c++)
                if (dfs(r, c, 0)) return true;
        return false;
    }

    private boolean dfs(int r, int c, int i) {
        if (r < 0 || c < 0 || r >= R || c >= C || g[r][c] != w[i]) return false;
        if (i == w.length - 1) return true;
        char saved = g[r][c];
        g[r][c] = '#';
        boolean found = dfs(r + 1, c, i + 1) || dfs(r - 1, c, i + 1) || dfs(r, c + 1, i + 1) || dfs(r, c - 1, i + 1);
        g[r][c] = saved;
        return found;
    }
}

public class Main {
    public static void main(String[] args) {
        String[] b = { "CAT", "XOD", "GSE" };
        System.out.println(new Solution().exist(b, "ATDOS") + " " + new Solution().exist(b, "TODO"));
    }
}
