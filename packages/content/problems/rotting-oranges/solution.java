import java.util.*;

class Solution {
    public int orangesRotting(int[][] grid) {
        int rows = grid.length, cols = grid[0].length;
        int[][] g = new int[rows][];
        for (int r = 0; r < rows; r++) g[r] = grid[r].clone();
        ArrayDeque<int[]> q = new ArrayDeque<>();
        int fresh = 0;
        for (int r = 0; r < rows; r++)
            for (int c = 0; c < cols; c++) {
                if (g[r][c] == 2) q.add(new int[] { r, c });
                if (g[r][c] == 1) fresh++;
            }
        int[] dr = { 1, -1, 0, 0 }, dc = { 0, 0, 1, -1 };
        int minutes = 0;
        while (!q.isEmpty() && fresh > 0) {
            for (int k = q.size(); k > 0; k--) {
                int[] p = q.poll();
                for (int d = 0; d < 4; d++) {
                    int nr = p[0] + dr[d], nc = p[1] + dc[d];
                    if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && g[nr][nc] == 1) {
                        g[nr][nc] = 2;
                        fresh--;
                        q.add(new int[] { nr, nc });
                    }
                }
            }
            minutes++;
        }
        return fresh > 0 ? -1 : minutes;
    }
}

public class Main {
    public static void main(String[] args) {
        System.out.println(new Solution().orangesRotting(new int[][] { { 2, 1, 1 }, { 1, 1, 0 }, { 0, 1, 1 } }));
    }
}
