import java.util.*;

class ObjectPool {
    private final long cap;
    private final int[] values;
    private final long[] gen;
    private final boolean[] live;
    private final int[] freeStack;
    private int freeTop = 0, nextFresh = 0, count = 0;

    public ObjectPool(int capacity) {
        cap = capacity;
        values = new int[capacity];
        gen = new long[capacity];
        live = new boolean[capacity];
        freeStack = new int[capacity];
    }

    private int find(long handle) {
        if (handle < 0) return -1;
        int slot = (int) (handle % cap);
        return live[slot] && gen[slot] == handle / cap ? slot : -1;
    }

    public long acquire(int value) {
        int slot;
        if (freeTop > 0) slot = freeStack[--freeTop];
        else if (nextFresh < cap) slot = nextFresh++;
        else return -1;
        values[slot] = value;
        live[slot] = true;
        count++;
        return gen[slot] * cap + slot;
    }

    public int get(long handle) {
        int s = find(handle);
        return s < 0 ? -1 : values[s];
    }

    public boolean set(long handle, int value) {
        int s = find(handle);
        if (s < 0) return false;
        values[s] = value;
        return true;
    }

    public boolean release(long handle) {
        int s = find(handle);
        if (s < 0) return false;
        live[s] = false;
        gen[s]++;
        freeStack[freeTop++] = s;
        count--;
        return true;
    }

    public int size() {
        return count;
    }
}

public class Main {
    public static void main(String[] args) {
        ObjectPool p = new ObjectPool(3);
        System.out.println(p.acquire(10) + " " + p.acquire(20) + " " + p.release(0) + " " + p.get(0) + " " + p.release(0));
        System.out.println(p.acquire(30) + " " + p.get(3) + " " + p.acquire(40) + " " + p.acquire(50) + " " + p.size());
    }
}
