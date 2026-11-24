class Solution {
    public int rob(int[] nums) {
        int prev2 = 0, prev1 = 0;
        for (int x : nums) {
            int cur = Math.max(prev1, prev2 + x);
            prev2 = prev1;
            prev1 = cur;
        }
        return prev1;
    }
}

public class Main {
    public static void main(String[] args) {
        System.out.println(new Solution().rob(new int[] { 3, 10, 4, 2, 8 }));
    }
}
