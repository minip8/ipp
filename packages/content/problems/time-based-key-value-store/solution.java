import java.util.*;

class TimeMap {
    private final Map<String, TreeMap<Integer, String>> store = new HashMap<>();

    public TimeMap() {}

    public void set(String key, String value, int timestamp) {
        store.computeIfAbsent(key, k -> new TreeMap<>()).put(timestamp, value);
    }

    public String get(String key, int timestamp) {
        TreeMap<Integer, String> versions = store.get(key);
        if (versions == null) return "";
        Map.Entry<Integer, String> e = versions.floorEntry(timestamp);
        return e == null ? "" : e.getValue();
    }
}

public class Main {
    public static void main(String[] args) {
        TimeMap m = new TimeMap();
        m.set("price", "100", 5);
        m.set("price", "105", 9);
        for (int t : new int[] {4, 5, 8, 9, 50}) System.out.print("\"" + m.get("price", t) + "\" ");
        System.out.println("\"" + m.get("volume", 9) + "\"");
    }
}
