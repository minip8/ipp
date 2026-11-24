import java.util.*;

class LFUCache {
    private final int cap;
    private int minCount = 0;
    private final Map<Integer, int[]> entries = new HashMap<>(); // key -> {value, count}
    private final Map<Integer, LinkedHashSet<Integer>> buckets = new HashMap<>(); // oldest use first

    public LFUCache(int capacity) {
        cap = capacity;
    }

    private void touch(int key, int[] e) {
        LinkedHashSet<Integer> from = buckets.get(e[1]);
        from.remove(key);
        if (from.isEmpty()) {
            buckets.remove(e[1]);
            if (minCount == e[1]) minCount++;
        }
        e[1]++;
        buckets.computeIfAbsent(e[1], c -> new LinkedHashSet<>()).add(key);
    }

    public int get(int key) {
        int[] e = entries.get(key);
        if (e == null) return -1;
        touch(key, e);
        return e[0];
    }

    public void put(int key, int value) {
        int[] e = entries.get(key);
        if (e != null) {
            e[0] = value;
            touch(key, e);
            return;
        }
        if (entries.size() >= cap) {
            LinkedHashSet<Integer> b = buckets.get(minCount);
            int victim = b.iterator().next();
            b.remove(victim);
            if (b.isEmpty()) buckets.remove(minCount);
            entries.remove(victim);
        }
        entries.put(key, new int[] { value, 1 });
        buckets.computeIfAbsent(1, c -> new LinkedHashSet<>()).add(key);
        minCount = 1;
    }
}

public class Main {
    public static void main(String[] args) {
        LFUCache c = new LFUCache(2);
        c.put(1, 10);
        c.put(2, 20);
        System.out.println(c.get(1));
        c.put(3, 30);
        System.out.println(c.get(2));
        System.out.println(c.get(3));
        c.put(4, 40);
        System.out.println(c.get(1) + " " + c.get(3) + " " + c.get(4));
    }
}
