import java.util.*;

class Solution {
    public int[] mergeKArrays(int[][] arrays) {
        PriorityQueue<int[]> heap = new PriorityQueue<>((a, b) -> Integer.compare(arrays[a[0]][a[1]], arrays[b[0]][b[1]]));
        int total = 0;
        for (int i = 0; i < arrays.length; i++) {
            total += arrays[i].length;
            if (arrays[i].length > 0) heap.add(new int[] {i, 0});
        }
        int[] out = new int[total];
        int n = 0;
        while (!heap.isEmpty()) {
            int[] top = heap.poll();
            out[n++] = arrays[top[0]][top[1]];
            if (top[1] + 1 < arrays[top[0]].length) heap.add(new int[] {top[0], top[1] + 1});
        }
        return out;
    }
}

public class Main {
    public static void main(String[] args) {
        System.out.println(Arrays.toString(new Solution().mergeKArrays(new int[][] {{1, 4, 5}, {1, 3, 4}, {2, 6}})));
    }
}
