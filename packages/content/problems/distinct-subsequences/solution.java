class Solution {
    public int numDistinct(String s, String t) {
        int k = t.length();
        if (k > s.length()) return 0;
        long[] ways = new long[k + 1];  // Java long arithmetic wraps mod 2^64; the answer is < 2^31
        ways[0] = 1;
        for (int i = 0; i < s.length(); i++) {
            char ch = s.charAt(i);
            for (int j = k; j >= 1; j--)
                if (t.charAt(j - 1) == ch) ways[j] += ways[j - 1];
        }
        return (int) ways[k];
    }
}

public class Main {
    public static void main(String[] args) {
        Solution s = new Solution();
        System.out.println(s.numDistinct("banana", "ban") + " " + s.numDistinct("aaa", "aa"));
    }
}
