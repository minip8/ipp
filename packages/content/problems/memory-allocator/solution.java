import java.util.*;

class Allocator {
    private final TreeMap<Integer, Integer> freeList = new TreeMap<>(); // start -> end (exclusive)
    private final Map<Integer, List<int[]>> owned = new HashMap<>();

    public Allocator(int n) {
        freeList.put(0, n);
    }

    public int allocate(int size, int mID) {
        for (Map.Entry<Integer, Integer> en : freeList.entrySet()) {
            int s = en.getKey(), e = en.getValue();
            if (e - s < size) continue;
            freeList.remove(s);
            if (e - s > size) freeList.put(s + size, e);
            owned.computeIfAbsent(mID, k -> new ArrayList<>()).add(new int[] { s, s + size });
            return s;
        }
        return -1;
    }

    private void release(int s, int e) {
        Map.Entry<Integer, Integer> left = freeList.lowerEntry(s);
        if (left != null && left.getValue() == s) {
            s = left.getKey();
            freeList.remove(s);
        }
        Integer rightEnd = freeList.get(e);
        if (rightEnd != null) {
            freeList.remove(e);
            e = rightEnd;
        }
        freeList.put(s, e);
    }

    public int freeMemory(int mID) {
        List<int[]> blocks = owned.remove(mID);
        if (blocks == null) return 0;
        int total = 0;
        for (int[] b : blocks) {
            release(b[0], b[1]);
            total += b[1] - b[0];
        }
        return total;
    }
}

public class Main {
    public static void main(String[] args) {
        Allocator a = new Allocator(10);
        System.out.println(a.allocate(3, 1) + " " + a.allocate(2, 2) + " " + a.allocate(4, 1));
        System.out.println(a.freeMemory(2) + " " + a.allocate(3, 3) + " " + a.allocate(1, 3));
        System.out.println(a.freeMemory(1) + " " + a.allocate(6, 4) + " " + a.freeMemory(9));
    }
}
