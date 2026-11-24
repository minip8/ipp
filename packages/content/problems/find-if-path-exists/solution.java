import java.util.*;

class Solution {
    private int[] parent;

    private int find(int x) {
        while (parent[x] != x) {
            parent[x] = parent[parent[x]];
            x = parent[x];
        }
        return x;
    }

    public boolean validPath(int n, int[][] edges, int source, int destination) {
        parent = new int[n];
        for (int i = 0; i < n; i++) parent[i] = i;
        for (int[] e : edges) parent[find(e[0])] = find(e[1]);
        return find(source) == find(destination);
    }
}

public class Main {
    public static void main(String[] args) {
        Solution s = new Solution();
        System.out.println(s.validPath(4, new int[][] { { 0, 1 }, { 1, 2 }, { 3, 3 } }, 0, 2));
        System.out.println(s.validPath(5, new int[][] { { 0, 1 }, { 2, 3 }, { 3, 4 } }, 1, 4));
    }
}
