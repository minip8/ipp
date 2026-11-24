import java.util.*;

class Solution {
    public int[][] floodFill(int[][] image, int sr, int sc, int color) {
        int rows = image.length, cols = image[0].length;
        int[][] out = new int[rows][];
        for (int r = 0; r < rows; r++) out[r] = image[r].clone();
        int old = out[sr][sc];
        if (old == color) return out;
        int[] dr = { 1, -1, 0, 0 }, dc = { 0, 0, 1, -1 };
        ArrayDeque<int[]> stack = new ArrayDeque<>();
        stack.push(new int[] { sr, sc });
        out[sr][sc] = color;
        while (!stack.isEmpty()) {
            int[] p = stack.pop();
            for (int d = 0; d < 4; d++) {
                int nr = p[0] + dr[d], nc = p[1] + dc[d];
                if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && out[nr][nc] == old) {
                    out[nr][nc] = color;
                    stack.push(new int[] { nr, nc });
                }
            }
        }
        return out;
    }
}

public class Main {
    public static void main(String[] args) {
        int[][] r = new Solution().floodFill(new int[][] { { 1, 1, 0 }, { 1, 0, 2 }, { 1, 1, 1 } }, 0, 0, 5);
        System.out.println(Arrays.deepToString(r));
    }
}
