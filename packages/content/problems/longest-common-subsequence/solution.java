class Solution {
    public int longestCommonSubsequence(String text1, String text2) {
        int m = text2.length();
        int[] prev = new int[m + 1], cur = new int[m + 1];
        for (int i = 0; i < text1.length(); i++) {
            char a = text1.charAt(i);
            for (int j = 1; j <= m; j++)
                cur[j] = a == text2.charAt(j - 1) ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
            int[] t = prev; prev = cur; cur = t;
        }
        return prev[m];
    }
}

public class Main {
    public static void main(String[] args) {
        System.out.println(new Solution().longestCommonSubsequence("kitten", "sitting"));
    }
}
