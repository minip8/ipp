// Circular buffer on a raw int[]; on growth the elements are copied out in order (unwrapped).
class RingDeque {
    private int[] buf = new int[8];
    private int head = 0; // index of the front element
    private int n = 0;

    private int at(int i) {
        int j = head + i;
        return j >= buf.length ? j - buf.length : j;
    }

    private void grow(int need) {
        if (need <= buf.length) return;
        int nc = buf.length;
        while (nc < need) nc *= 2;
        int[] nb = new int[nc];
        int first = Math.min(n, buf.length - head);
        System.arraycopy(buf, head, nb, 0, first);
        System.arraycopy(buf, 0, nb, first, n - first);
        buf = nb;
        head = 0;
    }

    public RingDeque() {}

    public void pushFront(int value) {
        grow(n + 1);
        head = head == 0 ? buf.length - 1 : head - 1;
        buf[head] = value;
        n++;
    }

    public void pushBack(int value) {
        grow(n + 1);
        buf[at(n)] = value;
        n++;
    }

    public int popFront() {
        if (n == 0) return -1;
        int v = buf[head];
        head = at(1);
        n--;
        return v;
    }

    public int popBack() {
        if (n == 0) return -1;
        n--;
        return buf[at(n)];
    }

    public int front() { return n == 0 ? -1 : buf[head]; }

    public int back() { return n == 0 ? -1 : buf[at(n - 1)]; }

    public int get(int index) { return index < 0 || index >= n ? -1 : buf[at(index)]; }

    public int size() { return n; }

    public void resize(int want, int value) {
        if (want > n) {
            grow(want);
            for (int i = n; i < want; i++) buf[at(i)] = value;
        }
        n = want;
    }

    public int[] toArray() {
        int[] out = new int[n];
        for (int i = 0; i < n; i++) out[i] = buf[at(i)];
        return out;
    }
}

public class Main {
    public static void main(String[] args) {
        RingDeque d = new RingDeque();
        d.pushBack(2);
        d.pushBack(3);
        d.pushFront(1);
        d.pushFront(0);
        System.out.println(d.get(1) + " " + d.popBack() + " " + d.popFront());
        d.pushBack(9);
        d.resize(5, 4);
        System.out.println(java.util.Arrays.toString(d.toArray()));
    }
}
