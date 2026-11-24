import java.util.*;

class SnapshotArray {
    private final List<TreeMap<Integer, Integer>> hist = new ArrayList<>();
    private int snapCount = 0;

    public SnapshotArray(int length) {
        for (int i = 0; i < length; i++) {
            TreeMap<Integer, Integer> m = new TreeMap<>();
            m.put(0, 0);
            hist.add(m);
        }
    }

    public void set(int index, int val) { hist.get(index).put(snapCount, val); }

    public int snap() { return snapCount++; }

    public int get(int index, int snapId) { return hist.get(index).floorEntry(snapId).getValue(); }
}

public class Main {
    public static void main(String[] args) {
        SnapshotArray a = new SnapshotArray(3);
        a.set(0, 5);
        System.out.println(a.snap());
        a.set(0, 6);
        a.set(2, 1);
        System.out.println(a.snap() + " " + a.snap());
        System.out.println(a.get(0, 0) + " " + a.get(0, 1) + " " + a.get(2, 0) + " " + a.get(2, 2) + " " + a.get(1, 2));
    }
}
