// Head and tail pointers with null ends (no sentinel), to show the explicit edge cases.
class DoublyLinkedList {
    private static final class Node {
        int val;
        Node prev, next;
        Node(int v) { val = v; }
    }

    private Node head, tail;
    private int n = 0;

    public DoublyLinkedList() {}

    // Node at position index (0 <= index < n), walking from the nearer end.
    private Node nodeAt(int index) {
        Node p;
        if (index <= n / 2) {
            p = head;
            for (int i = 0; i < index; i++) p = p.next;
        } else {
            p = tail;
            for (int i = n - 1; i > index; i--) p = p.prev;
        }
        return p;
    }

    private int unlink(Node node) {
        if (node.prev != null) node.prev.next = node.next; else head = node.next;
        if (node.next != null) node.next.prev = node.prev; else tail = node.prev;
        n--;
        return node.val;
    }

    public void pushFront(int value) {
        Node node = new Node(value);
        node.next = head;
        if (head != null) head.prev = node; else tail = node;
        head = node;
        n++;
    }

    public void pushBack(int value) {
        Node node = new Node(value);
        node.prev = tail;
        if (tail != null) tail.next = node; else head = node;
        tail = node;
        n++;
    }

    public int popFront() { return n == 0 ? -1 : unlink(head); }

    public int popBack() { return n == 0 ? -1 : unlink(tail); }

    public int front() { return n == 0 ? -1 : head.val; }

    public int back() { return n == 0 ? -1 : tail.val; }

    public int get(int index) { return index < 0 || index >= n ? -1 : nodeAt(index).val; }

    public boolean insert(int index, int value) {
        if (index < 0 || index > n) return false;
        if (index == 0) { pushFront(value); return true; }
        if (index == n) { pushBack(value); return true; }
        Node at = nodeAt(index);
        Node node = new Node(value);
        node.prev = at.prev;
        node.next = at;
        at.prev.next = node;
        at.prev = node;
        n++;
        return true;
    }

    public int erase(int index) { return index < 0 || index >= n ? -1 : unlink(nodeAt(index)); }

    public int size() { return n; }

    public void reverse() {
        for (Node p = head; p != null; p = p.prev) { // p.prev is the old next after the swap
            Node t = p.prev;
            p.prev = p.next;
            p.next = t;
        }
        Node t = head;
        head = tail;
        tail = t;
    }

    public int[] toArray() {
        int[] out = new int[n];
        int i = 0;
        for (Node p = head; p != null; p = p.next) out[i++] = p.val;
        return out;
    }

    public int[] toArrayReversed() {
        int[] out = new int[n];
        int i = 0;
        for (Node p = tail; p != null; p = p.prev) out[i++] = p.val;
        return out;
    }
}

public class Main {
    public static void main(String[] args) {
        DoublyLinkedList l = new DoublyLinkedList();
        for (int v : new int[] {1, 2, 3}) l.pushBack(v);
        l.pushFront(0);
        l.insert(2, 9);
        System.out.println(l.erase(0) + " " + l.popBack());
        l.reverse();
        System.out.println(java.util.Arrays.toString(l.toArray()));
    }
}
