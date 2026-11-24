import java.util.*;

class Solution {
    public int longestIncreasingPath(int[][] matrix) {
        // Cells in decreasing value order; iterative to avoid deep recursion on long snakes.
        int m = matrix.length, n = matrix[0].length;
        Integer[] order = new Integer[m * n];
        for (int i = 0; i < m * n; i++) order[i] = i;
        Arrays.sort(order, (a, b) -> Integer.compare(matrix[b / n][b % n], matrix[a / n][a % n]));
        int[][] best = new int[m][n];
        int[] dr = { -1, 1, 0, 0 }, dc = { 0, 0, -1, 1 };
        int answer = 1;
        for (int id : order) {
            int r = id / n, c = id % n, b = 1;
            for (int d = 0; d < 4; d++) {
                int nr = r + dr[d], nc = c + dc[d];
                if (nr >= 0 && nr < m && nc >= 0 && nc < n && matrix[nr][nc] > matrix[r][c])
                    b = Math.max(b, best[nr][nc] + 1);
            }
            best[r][c] = b;
            answer = Math.max(answer, b);
        }
        return answer;
    }
}

public class Main {
    public static void main(String[] args) {
        System.out.println(new Solution().longestIncreasingPath(new int[][] { { 7, 8, 9 }, { 6, 1, 2 }, { 5, 4, 3 } }));
    }
}
