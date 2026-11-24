// Raw int[] storage; a new block is allocated and the elements copied on every capacity change.
class DynamicArray {
    private int[] data = new int[0];
    private int n = 0;

    private void reallocate(int newCap) {
        int[] nd = new int[newCap];
        System.arraycopy(data, 0, nd, 0, n);
        data = nd;
    }

    private void growForOne() {
        if (n == data.length) reallocate(data.length == 0 ? 1 : 2 * data.length);
    }

    public DynamicArray() {}

    public void pushBack(int value) {
        growForOne();
        data[n++] = value;
    }

    public int popBack() { return n == 0 ? -1 : data[--n]; }

    public int get(int index) { return index >= 0 && index < n ? data[index] : -1; }

    public boolean set(int index, int value) {
        if (index < 0 || index >= n) return false;
        data[index] = value;
        return true;
    }

    public boolean insert(int index, int value) {
        if (index < 0 || index > n) return false;
        growForOne();
        System.arraycopy(data, index, data, index + 1, n - index);
        data[index] = value;
        n++;
        return true;
    }

    public int erase(int index) {
        if (index < 0 || index >= n) return -1;
        int removed = data[index];
        System.arraycopy(data, index + 1, data, index, n - index - 1);
        n--;
        return removed;
    }

    public int size() { return n; }

    public int capacity() { return data.length; }

    public void reserve(int want) {
        if (want > data.length) reallocate(want);
    }

    public void resize(int want, int value) {
        if (want > data.length) reallocate(Math.max(want, 2 * data.length));
        for (int i = n; i < want; i++) data[i] = value;
        n = want;
    }

    public void shrinkToFit() {
        if (data.length != n) reallocate(n);
    }

    public int[] toArray() {
        int[] out = new int[n];
        System.arraycopy(data, 0, out, 0, n);
        return out;
    }
}

public class Main {
    public static void main(String[] args) {
        DynamicArray a = new DynamicArray();
        for (int v : new int[] {5, 6, 7}) a.pushBack(v);
        System.out.println(a.capacity());
        a.insert(0, 4);
        System.out.println(a.erase(1) + " " + a.popBack());
        a.shrinkToFit();
        System.out.println(a.capacity());
    }
}
