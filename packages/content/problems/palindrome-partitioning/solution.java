import java.util.*;

class Solution {
    public List<List<String>> partition(String s) {
        int n = s.length();
        boolean[][] pal = new boolean[n][n];
        for (int i = n - 1; i >= 0; i--)
            for (int j = i; j < n; j++)
                pal[i][j] = s.charAt(i) == s.charAt(j) && (j - i < 2 || pal[i + 1][j - 1]);
        List<List<String>> res = new ArrayList<>();
        go(s, pal, 0, new ArrayList<>(), res);
        return res;
    }

    private void go(String s, boolean[][] pal, int start, List<String> path, List<List<String>> res) {
        if (start == s.length()) {
            res.add(new ArrayList<>(path));
            return;
        }
        for (int end = start; end < s.length(); end++) {
            if (!pal[start][end]) continue;
            path.add(s.substring(start, end + 1));
            go(s, pal, end + 1, path, res);
            path.remove(path.size() - 1);
        }
    }
}

public class Main {
    public static void main(String[] args) {
        System.out.println(new Solution().partition("abab"));
    }
}
