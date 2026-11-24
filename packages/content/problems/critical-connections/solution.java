import java.util.*;

class Solution {
    public List<List<Integer>> criticalConnections(int n, List<List<Integer>> connections) {
        List<List<Integer>> adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        for (List<Integer> c : connections) {
            adj.get(c.get(0)).add(c.get(1));
            adj.get(c.get(1)).add(c.get(0));
        }
        int[] tin = new int[n], low = new int[n], parent = new int[n], next = new int[n];
        Arrays.fill(tin, -1);
        List<List<Integer>> bridges = new ArrayList<>();
        int timer = 0;
        int[] stack = new int[n];
        int top = 0;
        stack[top++] = 0;
        parent[0] = -1;
        tin[0] = low[0] = timer++;
        while (top > 0) {
            int v = stack[top - 1];
            if (next[v] < adj.get(v).size()) {
                int u = adj.get(v).get(next[v]++);
                if (u == parent[v]) continue;
                if (tin[u] == -1) {
                    tin[u] = low[u] = timer++;
                    parent[u] = v;
                    stack[top++] = u;
                } else {
                    low[v] = Math.min(low[v], tin[u]);
                }
            } else {
                top--;
                int p = parent[v];
                if (p != -1) {
                    low[p] = Math.min(low[p], low[v]);
                    if (low[v] > tin[p]) bridges.add(List.of(p, v));
                }
            }
        }
        return bridges;
    }
}

public class Main {
    public static void main(String[] args) {
        List<List<Integer>> c = List.of(List.of(0, 1), List.of(1, 2), List.of(2, 0), List.of(1, 3), List.of(3, 4));
        System.out.println(new Solution().criticalConnections(5, c));
    }
}
