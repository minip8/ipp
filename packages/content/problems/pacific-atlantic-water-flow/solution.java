import java.util.*;

class Solution {
    private int rows, cols;

    private boolean[][] climb(int[][] h, ArrayDeque<int[]> stack) {
        boolean[][] seen = new boolean[rows][cols];
        for (int[] p : stack) seen[p[0]][p[1]] = true;
        int[] dr = { 1, -1, 0, 0 }, dc = { 0, 0, 1, -1 };
        while (!stack.isEmpty()) {
            int[] p = stack.pop();
            for (int d = 0; d < 4; d++) {
                int nr = p[0] + dr[d], nc = p[1] + dc[d];
                if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && !seen[nr][nc] && h[nr][nc] >= h[p[0]][p[1]]) {
                    seen[nr][nc] = true;
                    stack.push(new int[] { nr, nc });
                }
            }
        }
        return seen;
    }

    public List<List<Integer>> pacificAtlantic(int[][] heights) {
        rows = heights.length;
        cols = heights[0].length;
        ArrayDeque<int[]> pac = new ArrayDeque<>(), atl = new ArrayDeque<>();
        for (int c = 0; c < cols; c++) {
            pac.push(new int[] { 0, c });
            atl.push(new int[] { rows - 1, c });
        }
        for (int r = 0; r < rows; r++) {
            pac.push(new int[] { r, 0 });
            atl.push(new int[] { r, cols - 1 });
        }
        boolean[][] p = climb(heights, pac), a = climb(heights, atl);
        List<List<Integer>> out = new ArrayList<>();
        for (int r = 0; r < rows; r++)
            for (int c = 0; c < cols; c++)
                if (p[r][c] && a[r][c]) out.add(List.of(r, c));
        return out;
    }
}

public class Main {
    public static void main(String[] args) {
        System.out.println(new Solution().pacificAtlantic(new int[][] { { 1, 2, 3 }, { 8, 9, 4 }, { 7, 6, 5 } }));
    }
}
