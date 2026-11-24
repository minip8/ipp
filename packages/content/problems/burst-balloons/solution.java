class Solution {
    public int maxCoins(int[] nums) {
        int n = nums.length + 2;
        int[] a = new int[n];
        a[0] = a[n - 1] = 1;
        System.arraycopy(nums, 0, a, 1, nums.length);
        int[][] best = new int[n][n];
        for (int len = 2; len < n; len++)
            for (int i = 0; i + len < n; i++) {
                int j = i + len, top = 0;
                for (int k = i + 1; k < j; k++)
                    top = Math.max(top, best[i][k] + a[i] * a[k] * a[j] + best[k][j]);
                best[i][j] = top;
            }
        return best[0][n - 1];
    }
}

public class Main {
    public static void main(String[] args) {
        System.out.println(new Solution().maxCoins(new int[] { 4, 1, 6, 2 }));
    }
}
