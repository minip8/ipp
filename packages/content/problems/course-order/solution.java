import java.util.*;

class Solution {
    public int[] findOrder(int numCourses, int[][] prerequisites) {
        List<List<Integer>> out = new ArrayList<>();
        for (int i = 0; i < numCourses; i++) out.add(new ArrayList<>());
        int[] indeg = new int[numCourses];
        for (int[] p : prerequisites) {
            out.get(p[1]).add(p[0]);
            indeg[p[0]]++;
        }
        PriorityQueue<Integer> ready = new PriorityQueue<>();
        for (int i = 0; i < numCourses; i++) if (indeg[i] == 0) ready.add(i);
        int[] order = new int[numCourses];
        int k = 0;
        while (!ready.isEmpty()) {
            int u = ready.poll();
            order[k++] = u;
            for (int v : out.get(u)) if (--indeg[v] == 0) ready.add(v);
        }
        return k == numCourses ? order : new int[0];
    }
}

public class Main {
    public static void main(String[] args) {
        Solution s = new Solution();
        System.out.println(Arrays.toString(s.findOrder(4, new int[][] { { 1, 0 }, { 2, 0 }, { 3, 1 }, { 3, 2 } })));
        System.out.println(Arrays.toString(s.findOrder(4, new int[][] { { 0, 3 }, { 1, 3 } })));
    }
}
