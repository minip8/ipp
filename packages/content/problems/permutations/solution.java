import java.util.*;

class Solution {
    public List<List<Integer>> permute(int[] nums) {
        List<List<Integer>> res = new ArrayList<>();
        go(nums, new boolean[nums.length], new ArrayList<>(), res);
        return res;
    }

    private void go(int[] nums, boolean[] used, List<Integer> cur, List<List<Integer>> res) {
        if (cur.size() == nums.length) {
            res.add(new ArrayList<>(cur));
            return;
        }
        for (int i = 0; i < nums.length; i++) {
            if (used[i]) continue;
            used[i] = true;
            cur.add(nums[i]);
            go(nums, used, cur, res);
            cur.remove(cur.size() - 1);
            used[i] = false;
        }
    }
}

public class Main {
    public static void main(String[] args) {
        System.out.println(new Solution().permute(new int[] { 1, 2, 3 }));
    }
}
