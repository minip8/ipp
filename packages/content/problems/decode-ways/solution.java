class Solution {
    public int numDecodings(String s) {
        int prev2 = 0, prev1 = 1;
        for (int i = 1; i <= s.length(); i++) {
            int cur = s.charAt(i - 1) != '0' ? prev1 : 0;
            if (i >= 2) {
                int two = (s.charAt(i - 2) - '0') * 10 + (s.charAt(i - 1) - '0');
                if (two >= 10 && two <= 26) cur += prev2;
            }
            prev2 = prev1;
            prev1 = cur;
        }
        return prev1;
    }
}

public class Main {
    public static void main(String[] args) {
        Solution s = new Solution();
        System.out.println(s.numDecodings("226") + " " + s.numDecodings("105") + " " + s.numDecodings("30"));
    }
}
