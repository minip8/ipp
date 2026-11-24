// Max-heap on a raw int[] that doubles when full.
class BinaryHeap {
    private static final int EMPTY = Integer.MIN_VALUE;
    private int[] a = new int[16];
    private int n = 0;

    private void swap(int i, int j) {
        int t = a[i];
        a[i] = a[j];
        a[j] = t;
    }

    private void siftUp(int i) {
        while (i > 0) {
            int p = (i - 1) / 2;
            if (a[i] <= a[p]) break;
            swap(i, p);
            i = p;
        }
    }

    private void siftDown(int i) {
        while (true) {
            int c = 2 * i + 1;
            if (c >= n) return;
            if (c + 1 < n && a[c + 1] > a[c]) c++;
            if (a[c] <= a[i]) return;
            swap(i, c);
            i = c;
        }
    }

    public BinaryHeap() {}

    public void push(int value) {
        if (n == a.length) a = java.util.Arrays.copyOf(a, 2 * a.length);
        a[n] = value;
        siftUp(n++);
    }

    public int pop() {
        if (n == 0) return EMPTY;
        int top = a[0];
        a[0] = a[--n];
        if (n > 0) siftDown(0);
        return top;
    }

    public int top() { return n == 0 ? EMPTY : a[0]; }

    public int size() { return n; }

    public void build(int[] values) {
        a = java.util.Arrays.copyOf(values, Math.max(16, values.length));
        n = values.length;
        for (int i = n / 2 - 1; i >= 0; i--) siftDown(i);
    }

    public int replaceTop(int value) {
        if (n == 0) {
            push(value);
            return EMPTY;
        }
        int top = a[0];
        a[0] = value;
        siftDown(0);
        return top;
    }

    public int[] toArray() { return java.util.Arrays.copyOf(a, n); }
}

public class Main {
    public static void main(String[] args) {
        BinaryHeap h = new BinaryHeap();
        for (int v : new int[] {3, 8, 5, 9}) h.push(v);
        System.out.println(h.pop());
        System.out.println(h.replaceTop(1));
        h.build(new int[] {1, 2, 3, 4, 5});
        System.out.println(java.util.Arrays.toString(h.toArray()));
    }
}
