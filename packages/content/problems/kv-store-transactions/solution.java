import java.util.*;

class KVStore {
    private final Map<String, Integer> data = new HashMap<>();
    private final Map<Integer, Integer> counts = new HashMap<>();
    // Undo logs: key -> value before the transaction first touched it (null = absent).
    private final Deque<Map<String, Integer>> logs = new ArrayDeque<>();

    public KVStore() {}

    private void write(String key, Integer value) {
        Integer old = data.get(key);
        if (old != null) counts.merge(old, -1, Integer::sum);
        if (value == null) data.remove(key);
        else {
            data.put(key, value);
            counts.merge(value, 1, Integer::sum);
        }
    }

    private void log(String key) {
        Map<String, Integer> top = logs.peek();
        if (top != null && !top.containsKey(key)) top.put(key, data.get(key));
    }

    public void set(String key, int value) {
        log(key);
        write(key, value);
    }

    public int get(String key) {
        return data.getOrDefault(key, -1);
    }

    public void unset(String key) {
        if (!data.containsKey(key)) return;
        log(key);
        write(key, null);
    }

    public int count(int value) {
        return counts.getOrDefault(value, 0);
    }

    public void begin() {
        logs.push(new HashMap<>());
    }

    public boolean rollback() {
        if (logs.isEmpty()) return false;
        for (Map.Entry<String, Integer> e : logs.pop().entrySet()) write(e.getKey(), e.getValue());
        return true;
    }

    public boolean commit() {
        if (logs.isEmpty()) return false;
        Map<String, Integer> child = logs.pop();
        Map<String, Integer> parent = logs.peek();
        if (parent != null)
            for (Map.Entry<String, Integer> e : child.entrySet())
                if (!parent.containsKey(e.getKey())) parent.put(e.getKey(), e.getValue());
        return true;
    }
}

public class Main {
    public static void main(String[] args) {
        KVStore db = new KVStore();
        db.set("a", 10);
        db.begin();
        db.set("a", 20);
        db.set("b", 20);
        System.out.println(db.count(20));
        db.begin();
        db.unset("a");
        System.out.println(db.get("a") + " " + db.rollback() + " " + db.get("a"));
        System.out.println(db.commit() + " " + db.rollback() + " " + db.get("a") + " " + db.count(10));
    }
}
