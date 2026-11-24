class Solution {
    public int maximalSquare(String[] matrix) {
        int cols = matrix[0].length();
        int[] prev = new int[cols + 1], cur = new int[cols + 1];
        int best = 0;
        for (String row : matrix) {
            for (int c = 1; c <= cols; c++) {
                cur[c] = row.charAt(c - 1) == '1' ? 1 + Math.min(prev[c - 1], Math.min(prev[c], cur[c - 1])) : 0;
                best = Math.max(best, cur[c]);
            }
            int[] t = prev; prev = cur; cur = t;
        }
        return best * best;
    }
}

public class Main {
    public static void main(String[] args) {
        System.out.println(new Solution().maximalSquare(new String[] { "10100", "10111", "11111", "10010" }));
    }
}
