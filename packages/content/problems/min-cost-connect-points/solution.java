import java.util.*;

class Solution {
    public int minCostConnectPoints(int[][] points) {
        int n = points.length;
        long[] dist = new long[n];
        boolean[] inTree = new boolean[n];
        Arrays.fill(dist, Long.MAX_VALUE);
        dist[0] = 0;
        long total = 0;
        for (int iter = 0; iter < n; iter++) {
            int u = -1;
            for (int v = 0; v < n; v++)
                if (!inTree[v] && (u == -1 || dist[v] < dist[u])) u = v;
            inTree[u] = true;
            total += dist[u];
            for (int v = 0; v < n; v++) {
                if (inTree[v]) continue;
                long d = Math.abs((long) points[v][0] - points[u][0]) + Math.abs((long) points[v][1] - points[u][1]);
                if (d < dist[v]) dist[v] = d;
            }
        }
        return (int) total;
    }
}

public class Main {
    public static void main(String[] args) {
        int[][] pts = {{0, 0}, {2, 2}, {3, 10}, {5, 2}, {7, 0}};
        System.out.println(new Solution().minCostConnectPoints(pts));
    }
}
