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

    public List<List<String>> accountsMerge(List<List<String>> accounts) {
        int n = accounts.size();
        parent = new int[n];
        for (int i = 0; i < n; i++) parent[i] = i;
        Map<String, Integer> owner = new HashMap<>();
        for (int i = 0; i < n; i++) {
            List<String> acc = accounts.get(i);
            for (int j = 1; j < acc.size(); j++) {
                Integer prev = owner.putIfAbsent(acc.get(j), i);
                if (prev != null) {
                    int a = find(prev), b = find(i);
                    if (a != b) parent[b] = a;
                }
            }
        }
        Map<Integer, List<String>> groups = new HashMap<>();
        for (Map.Entry<String, Integer> e : owner.entrySet()) {
            groups.computeIfAbsent(find(e.getValue()), k -> new ArrayList<>()).add(e.getKey());
        }
        List<List<String>> result = new ArrayList<>();
        for (Map.Entry<Integer, List<String>> g : groups.entrySet()) {
            List<String> emails = g.getValue();
            Collections.sort(emails);
            List<String> entry = new ArrayList<>();
            entry.add(accounts.get(g.getKey()).get(0));
            entry.addAll(emails);
            result.add(entry);
        }
        return result;
    }
}

public class Main {
    public static void main(String[] args) {
        List<List<String>> accounts = List.of(
            List.of("Ana", "ana@x.io", "ana.k@mail.com"),
            List.of("Ben", "ben@y.org"),
            List.of("Ana", "a.k@work.net", "ana@x.io"),
            List.of("Ana", "ana2@x.io"));
        System.out.println(new Solution().accountsMerge(accounts));
    }
}
