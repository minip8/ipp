import java.util.*;

class Solution {
    public List<List<Integer>> subsets(int[] nums) {
        List<List<Integer>> res = new ArrayList<>();
        int n = nums.length;
        for (int mask = 0; mask < (1 << n); mask++) {
            List<Integer> sub = new ArrayList<>();
            for (int i = 0; i < n; i++) if ((mask >> i & 1) == 1) sub.add(nums[i]);
            res.add(sub);
        }
        return res;
    }
}

public class Main {
    public static void main(String[] args) {
        System.out.println(new Solution().subsets(new int[] { 1, 2, 3 }));
    }
}
