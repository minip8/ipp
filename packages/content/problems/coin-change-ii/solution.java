class Solution {
    public long change(int amount, int[] coins) {
        long[] dp = new long[amount + 1];
        dp[0] = 1;
        for (int c : coins)
            for (int a = c; a <= amount; a++)
                dp[a] += dp[a - c];
        return dp[amount];
    }
}

public class Main {
    public static void main(String[] args) {
        System.out.println(new Solution().change(5, new int[] { 1, 2, 5 }));
    }
}
