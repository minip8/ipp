import java.util.*;

class Solution {
    public boolean canFinish(int numCourses, int[][] prerequisites) {
        List<List<Integer>> out = new ArrayList<>();
        for (int i = 0; i < numCourses; i++) out.add(new ArrayList<>());
        int[] indeg = new int[numCourses];
        for (int[] p : prerequisites) {
            out.get(p[1]).add(p[0]);
            indeg[p[0]]++;
        }
        ArrayDeque<Integer> ready = new ArrayDeque<>();
        for (int i = 0; i < numCourses; i++) if (indeg[i] == 0) ready.add(i);
        int taken = 0;
        while (!ready.isEmpty()) {
            int u = ready.poll();
            taken++;
            for (int v : out.get(u)) if (--indeg[v] == 0) ready.add(v);
        }
        return taken == numCourses;
    }
}

public class Main {
    public static void main(String[] args) {
        Solution s = new Solution();
        System.out.println(s.canFinish(3, new int[][] { { 1, 0 }, { 2, 1 } }));
        System.out.println(s.canFinish(2, new int[][] { { 1, 0 }, { 0, 1 } }));
    }
}
