import java.util.*;

class WordDictionary {
    private static final class Node {
        final Node[] next = new Node[26];
        boolean word;
    }

    private final Node root = new Node();

    public WordDictionary() {}

    public void addWord(String word) {
        Node cur = root;
        for (int i = 0; i < word.length(); i++) {
            int k = word.charAt(i) - 'a';
            if (cur.next[k] == null) cur.next[k] = new Node();
            cur = cur.next[k];
        }
        cur.word = true;
    }

    public boolean search(String pattern) {
        return dfs(root, pattern, 0);
    }

    private boolean dfs(Node node, String p, int i) {
        for (; i < p.length(); i++) {
            char ch = p.charAt(i);
            if (ch == '.') {
                for (Node child : node.next)
                    if (child != null && dfs(child, p, i + 1)) return true;
                return false;
            }
            node = node.next[ch - 'a'];
            if (node == null) return false;
        }
        return node.word;
    }
}

public class Main {
    public static void main(String[] args) {
        WordDictionary d = new WordDictionary();
        for (String w : new String[] { "bad", "dad", "mad" }) d.addWord(w);
        System.out.println(d.search("pad") + " " + d.search(".ad") + " " + d.search("b..") + " " + d.search("b."));
    }
}
