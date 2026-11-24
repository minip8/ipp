import java.util.*;

class Solution {
    public List<List<Integer>> combinationSum(int[] candidates, int target) {
        int[] c = candidates.clone();
        Arrays.sort(c);
        List<List<Integer>> res = new ArrayList<>();
        go(c, 0, target, new ArrayList<>(), res);
        return res;
    }

    private void go(int[] c, int start, int remaining, List<Integer> path, List<List<Integer>> res) {
        if (remaining == 0) {
            res.add(new ArrayList<>(path));
            return;
        }
        for (int j = start; j < c.length && c[j] <= remaining; j++) {
            path.add(c[j]);
            go(c, j, remaining - c[j], path, res);
            path.remove(path.size() - 1);
        }
    }
}

public class Main {
    public static void main(String[] args) {
        System.out.println(new Solution().combinationSum(new int[] { 3, 4, 7 }, 7));
    }
}
