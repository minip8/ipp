import java.util.*;

// Separate chaining with resizing.
class MyHashMap {
    private static final class Node {
        final int key;
        int value;
        Node next;
        Node(int k, int v, Node n) { key = k; value = v; next = n; }
    }

    private Node[] buckets = new Node[16];
    private int size = 0;

    private int index(int key, int n) {
        int h = key * 0x9E3779B1;
        return (h ^ (h >>> 16)) & (n - 1);
    }

    public MyHashMap() {}

    public void put(int key, int value) {
        int i = index(key, buckets.length);
        for (Node p = buckets[i]; p != null; p = p.next)
            if (p.key == key) { p.value = value; return; }
        buckets[i] = new Node(key, value, buckets[i]);
        if (++size > buckets.length) resize();
    }

    public int get(int key) {
        for (Node p = buckets[index(key, buckets.length)]; p != null; p = p.next)
            if (p.key == key) return p.value;
        return -1;
    }

    public void remove(int key) {
        int i = index(key, buckets.length);
        Node dummy = new Node(0, 0, buckets[i]);
        for (Node p = dummy; p.next != null; p = p.next)
            if (p.next.key == key) { p.next = p.next.next; size--; break; }
        buckets[i] = dummy.next;
    }

    private void resize() {
        Node[] nb = new Node[buckets.length * 2];
        for (Node head : buckets)
            for (Node p = head; p != null; ) {
                Node nx = p.next;
                int i = index(p.key, nb.length);
                p.next = nb[i];
                nb[i] = p;
                p = nx;
            }
        buckets = nb;
    }
}

public class Main {
    public static void main(String[] args) {
        MyHashMap m = new MyHashMap();
        m.put(3, 30);
        m.put(1003, 7);
        System.out.println(m.get(3) + " " + m.get(1003) + " " + m.get(5));
        m.remove(1003);
        System.out.println(m.get(1003));
    }
}
