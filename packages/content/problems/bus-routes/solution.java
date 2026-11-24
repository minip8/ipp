import java.util.*;

class Solution {
    public int numBusesToDestination(int[][] routes, int source, int target) {
        if (source == target) return 0;
        Map<Integer, List<Integer>> busesAt = new HashMap<>();
        for (int b = 0; b < routes.length; b++)
            for (int s : routes[b]) busesAt.computeIfAbsent(s, k -> new ArrayList<>()).add(b);
        if (!busesAt.containsKey(source) || !busesAt.containsKey(target)) return -1;
        boolean[] busSeen = new boolean[routes.length];
        Set<Integer> stopDone = new HashSet<>();
        stopDone.add(source);
        ArrayDeque<int[]> q = new ArrayDeque<>();
        for (int b : busesAt.get(source)) {
            busSeen[b] = true;
            q.add(new int[] {b, 1});
        }
        while (!q.isEmpty()) {
            int[] cur = q.poll();
            for (int s : routes[cur[0]]) {
                if (s == target) return cur[1];
                if (!stopDone.add(s)) continue;
                for (int nb : busesAt.get(s)) {
                    if (busSeen[nb]) continue;
                    busSeen[nb] = true;
                    q.add(new int[] {nb, cur[1] + 1});
                }
            }
        }
        return -1;
    }
}

public class Main {
    public static void main(String[] args) {
        System.out.println(new Solution().numBusesToDestination(new int[][] {{1, 4, 7}, {3, 6, 7}}, 1, 6));
    }
}
