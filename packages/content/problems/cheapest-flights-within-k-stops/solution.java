import java.util.*;

class Solution {
    public int findCheapestPrice(int n, int[][] flights, int src, int dst, int k) {
        final long INF = Long.MAX_VALUE / 4;
        long[] cost = new long[n];
        Arrays.fill(cost, INF);
        cost[src] = 0;
        for (int round = 0; round <= k; round++) {
            long[] next = cost.clone();
            boolean changed = false;
            for (int[] f : flights) {
                if (cost[f[0]] + f[2] < next[f[1]]) {
                    next[f[1]] = cost[f[0]] + f[2];
                    changed = true;
                }
            }
            cost = next;
            if (!changed) break;
        }
        return cost[dst] >= INF ? -1 : (int) cost[dst];
    }
}

public class Main {
    public static void main(String[] args) {
        int[][] f = { { 0, 1, 100 }, { 1, 2, 100 }, { 2, 0, 100 }, { 1, 3, 600 }, { 2, 3, 200 } };
        System.out.println(new Solution().findCheapestPrice(4, f, 0, 3, 1));
    }
}
