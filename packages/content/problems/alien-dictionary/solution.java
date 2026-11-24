import java.util.*;

class Solution {
    public String alienOrder(String[] words) {
        boolean[] present = new boolean[26];
        boolean[][] edge = new boolean[26][26];
        int[] indeg = new int[26];
        for (String w : words) for (char ch : w.toCharArray()) present[ch - 'a'] = true;
        for (int i = 0; i + 1 < words.length; i++) {
            String a = words[i], b = words[i + 1];
            int n = Math.min(a.length(), b.length()), j = 0;
            while (j < n && a.charAt(j) == b.charAt(j)) j++;
            if (j == n) {
                if (a.length() > b.length()) return "";
                continue;
            }
            int x = a.charAt(j) - 'a', y = b.charAt(j) - 'a';
            if (!edge[x][y]) {
                edge[x][y] = true;
                indeg[y]++;
            }
        }
        PriorityQueue<Integer> ready = new PriorityQueue<>();
        int total = 0;
        for (int c = 0; c < 26; c++) {
            if (!present[c]) continue;
            total++;
            if (indeg[c] == 0) ready.add(c);
        }
        StringBuilder out = new StringBuilder();
        while (!ready.isEmpty()) {
            int c = ready.poll();
            out.append((char) ('a' + c));
            for (int d = 0; d < 26; d++) if (edge[c][d] && --indeg[d] == 0) ready.add(d);
        }
        return out.length() == total ? out.toString() : "";
    }
}

public class Main {
    public static void main(String[] args) {
        Solution s = new Solution();
        System.out.println(s.alienOrder(new String[] { "wrt", "wrf", "er", "ett", "rftt" }));
        System.out.println(s.alienOrder(new String[] { "zx", "zy", "q" }));
    }
}
