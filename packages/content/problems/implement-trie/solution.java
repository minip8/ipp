import java.util.*;

class Trie {
    private static final class Node {
        final Node[] next = new Node[26];
        boolean word;
    }

    private final Node root = new Node();

    public Trie() {}

    public void insert(String word) {
        Node cur = root;
        for (int i = 0; i < word.length(); i++) {
            int k = word.charAt(i) - 'a';
            if (cur.next[k] == null) cur.next[k] = new Node();
            cur = cur.next[k];
        }
        cur.word = true;
    }

    private Node walk(String s) {
        Node cur = root;
        for (int i = 0; i < s.length() && cur != null; i++) cur = cur.next[s.charAt(i) - 'a'];
        return cur;
    }

    public boolean search(String word) {
        Node n = walk(word);
        return n != null && n.word;
    }

    public boolean startsWith(String prefix) {
        return walk(prefix) != null;
    }
}

public class Main {
    public static void main(String[] args) {
        Trie t = new Trie();
        t.insert("card");
        System.out.println(t.search("car") + " " + t.startsWith("car"));
    }
}
