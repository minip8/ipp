import java.util.*;

class Solution {
    public int[][] kClosest(int[][] points, int k) {
        PriorityQueue<long[]> heap = new PriorityQueue<>((a, b) -> Long.compare(b[0], a[0]));
        for (int i = 0; i < points.length; i++) {
            long d = (long) points[i][0] * points[i][0] + (long) points[i][1] * points[i][1];
            if (heap.size() < k) heap.add(new long[] {d, i});
            else if (d < heap.peek()[0]) {
                heap.poll();
                heap.add(new long[] {d, i});
            }
        }
        int[][] out = new int[heap.size()][];
        int j = 0;
        for (long[] e : heap) out[j++] = points[(int) e[1]];
        return out;
    }
}

public class Main {
    public static void main(String[] args) {
        int[][] r = new Solution().kClosest(new int[][] {{1, 3}, {-2, 2}, {5, -1}}, 2);
        System.out.println(Arrays.deepToString(r));
    }
}
