class Solution {
    public boolean canPartition(int[] nums) {
        int total = 0;
        for (int x : nums) total += x;
        if (total % 2 != 0) return false;
        int half = total / 2;
        boolean[] reach = new boolean[half + 1];
        reach[0] = true;
        for (int x : nums)
            for (int s = half; s >= x; s--)
                if (reach[s - x]) reach[s] = true;
        return reach[half];
    }
}

public class Main {
    public static void main(String[] args) {
        Solution s = new Solution();
        System.out.println(s.canPartition(new int[] { 2, 3, 4, 5 }) + " " + s.canPartition(new int[] { 1, 2, 5 }));
    }
}
