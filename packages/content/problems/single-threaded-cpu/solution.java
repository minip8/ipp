import java.util.*;

class Solution {
    public int[] getOrder(int[][] tasks) {
        int n = tasks.length;
        Integer[] order = new Integer[n];
        for (int i = 0; i < n; i++) order[i] = i;
        Arrays.sort(order, (a, b) -> Integer.compare(tasks[a][0], tasks[b][0]));
        PriorityQueue<Integer> heap = new PriorityQueue<>((a, b) ->
            tasks[a][1] != tasks[b][1] ? Integer.compare(tasks[a][1], tasks[b][1]) : Integer.compare(a, b));
        int[] out = new int[n];
        int done = 0, j = 0;
        long clock = 0;
        while (done < n) {
            if (heap.isEmpty() && clock < tasks[order[j]][0]) clock = tasks[order[j]][0];
            while (j < n && tasks[order[j]][0] <= clock) heap.add(order[j++]);
            int i = heap.poll();
            out[done++] = i;
            clock += tasks[i][1];
        }
        return out;
    }
}

public class Main {
    public static void main(String[] args) {
        System.out.println(Arrays.toString(new Solution().getOrder(new int[][] {{1, 3}, {2, 1}, {3, 2}, {4, 1}})));
    }
}
