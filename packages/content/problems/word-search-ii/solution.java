import java.util.*;

class Solution {
    private static final class Node {
        final Node[] next = new Node[26];
        String word;
        int children;
    }

    private char[][] g;
    private List<String> found;

    public List<String> findWords(String[] board, String[] words) {
        Node root = new Node();
        for (String w : words) {
            Node cur = root;
            for (char ch : w.toCharArray()) {
                int k = ch - 'a';
                if (cur.next[k] == null) {
                    cur.next[k] = new Node();
                    cur.children++;
                }
                cur = cur.next[k];
            }
            cur.word = w;
        }
        g = new char[board.length][];
        for (int r = 0; r < board.length; r++) g[r] = board[r].toCharArray();
        found = new ArrayList<>();
        for (int r = 0; r < g.length; r++)
            for (int c = 0; c < g[0].length; c++) dfs(r, c, root);
        return found;
    }

    private void dfs(int r, int c, Node parent) {
        char ch = g[r][c];
        if (ch == '#') return;
        Node node = parent.next[ch - 'a'];
        if (node == null) return;
        if (node.word != null) {
            found.add(node.word);
            node.word = null;
        }
        g[r][c] = '#';
        if (r > 0) dfs(r - 1, c, node);
        if (r + 1 < g.length) dfs(r + 1, c, node);
        if (c > 0) dfs(r, c - 1, node);
        if (c + 1 < g[0].length) dfs(r, c + 1, node);
        g[r][c] = ch;
        if (node.children == 0 && node.word == null) {
            parent.next[ch - 'a'] = null;
            parent.children--;
        }
    }
}

public class Main {
    public static void main(String[] args) {
        String[] board = { "cats", "rohe", "bnep" };
        String[] words = { "cat", "cats", "hat", "the", "hen", "rob", "orb", "peep" };
        System.out.println(new Solution().findWords(board, words));
    }
}
