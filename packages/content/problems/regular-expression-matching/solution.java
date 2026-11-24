class Solution {
    public boolean isMatch(String s, String p) {
        int n = s.length(), m = p.length();
        boolean[][] M = new boolean[n + 1][m + 1];
        M[n][m] = true;
        for (int i = n; i >= 0; i--)
            for (int j = m - 1; j >= 0; j--) {
                if (p.charAt(j) == '*') continue;
                boolean first = i < n && (p.charAt(j) == s.charAt(i) || p.charAt(j) == '.');
                if (j + 1 < m && p.charAt(j + 1) == '*') M[i][j] = M[i][j + 2] || (first && M[i + 1][j]);
                else M[i][j] = first && M[i + 1][j + 1];
            }
        return M[0][0];
    }
}

public class Main {
    public static void main(String[] args) {
        Solution s = new Solution();
        System.out.println(s.isMatch("aab", "c*a*b") + " " + s.isMatch("ab", ".*c"));
    }
}
