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

    public int countComponents(int n, int[][] edges) {
        parent = new int[n];
        int[] size = new int[n];
        for (int i = 0; i < n; i++) { parent[i] = i; size[i] = 1; }
        int components = n;
        for (int[] e : edges) {
            int a = find(e[0]), b = find(e[1]);
            if (a == b) continue;
            if (size[a] < size[b]) { int t = a; a = b; b = t; }
            parent[b] = a;
            size[a] += size[b];
            components--;
        }
        return components;
    }
}

public class Main {
    public static void main(String[] args) {
        System.out.println(new Solution().countComponents(6, new int[][] {{0, 1}, {1, 2}, {4, 5}}));
    }
}
