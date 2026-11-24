import java.util.*;

class LRUCache {
    private final int cap;
    private final LinkedHashMap<Integer, Integer> map;

    public LRUCache(int capacity) {
        cap = capacity;
        map = new LinkedHashMap<>(16, 0.75f, true) {
            @Override
            protected boolean removeEldestEntry(Map.Entry<Integer, Integer> e) {
                return size() > cap;
            }
        };
    }

    public int get(int key) {
        return map.getOrDefault(key, -1);
    }

    public void put(int key, int value) {
        map.put(key, value);
    }
}

public class Main {
    public static void main(String[] args) {
        LRUCache c = new LRUCache(2);
        c.put(1, 10);
        c.put(2, 20);
        System.out.println(c.get(1));
        c.put(3, 30);
        System.out.println(c.get(2));
    }
}
