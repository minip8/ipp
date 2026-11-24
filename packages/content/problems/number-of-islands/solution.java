import java.util.*;

class Solution {
    public int numIslands(String[] grid) {
        int rows = grid.length, cols = grid[0].length();
        boolean[][] seen = new boolean[rows][cols];
        int[] dr = { 1, -1, 0, 0 }, dc = { 0, 0, 1, -1 };
        int count = 0;
        ArrayDeque<int[]> stack = new ArrayDeque<>();
        for (int r = 0; r < rows; r++) {
            for (int c = 0; c < cols; c++) {
                if (grid[r].charAt(c) != '1' || seen[r][c]) continue;
                count++;
                seen[r][c] = true;
                stack.push(new int[] { r, c });
                while (!stack.isEmpty()) {
                    int[] p = stack.pop();
                    for (int d = 0; d < 4; d++) {
                        int ny = p[0] + dr[d], nx = p[1] + dc[d];
                        if (ny >= 0 && ny < rows && nx >= 0 && nx < cols && grid[ny].charAt(nx) == '1' && !seen[ny][nx]) {
                            seen[ny][nx] = true;
                            stack.push(new int[] { ny, nx });
                        }
                    }
                }
            }
        }
        return count;
    }
}

public class Main {
    public static void main(String[] args) {
        System.out.println(new Solution().numIslands(new String[] { "11000", "11000", "00100", "00011" }));
    }
}
