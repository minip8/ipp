import java.util.*;

class Solution {
    public int shortestPathBinaryMatrix(int[][] grid) {
        int n = grid.length;
        if (grid[0][0] != 0 || grid[n - 1][n - 1] != 0) return -1;
        int[][] dist = new int[n][n];
        dist[0][0] = 1;
        ArrayDeque<int[]> q = new ArrayDeque<>();
        q.add(new int[] { 0, 0 });
        while (!q.isEmpty()) {
            int[] p = q.poll();
            int r = p[0], c = p[1];
            if (r == n - 1 && c == n - 1) return dist[r][c];
            for (int dr = -1; dr <= 1; dr++)
                for (int dc = -1; dc <= 1; dc++) {
                    int nr = r + dr, nc = c + dc;
                    if (nr >= 0 && nr < n && nc >= 0 && nc < n && grid[nr][nc] == 0 && dist[nr][nc] == 0) {
                        dist[nr][nc] = dist[r][c] + 1;
                        q.add(new int[] { nr, nc });
                    }
                }
        }
        return -1;
    }
}

public class Main {
    public static void main(String[] args) {
        System.out.println(new Solution().shortestPathBinaryMatrix(new int[][] { { 0, 0, 0 }, { 1, 1, 0 }, { 1, 1, 0 } }));
    }
}
