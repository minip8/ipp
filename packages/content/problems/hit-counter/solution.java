import java.util.*;

class HitCounter {
    private final ArrayDeque<int[]> buckets = new ArrayDeque<>();  // {timestamp, count}
    private int total = 0;

    public HitCounter() {}

    private void expire(int timestamp) {
        while (!buckets.isEmpty() && buckets.peekFirst()[0] <= timestamp - 300)
            total -= buckets.pollFirst()[1];
    }

    public void hit(int timestamp) {
        expire(timestamp);
        if (!buckets.isEmpty() && buckets.peekLast()[0] == timestamp) buckets.peekLast()[1]++;
        else buckets.addLast(new int[] {timestamp, 1});
        total++;
    }

    public int getHits(int timestamp) {
        expire(timestamp);
        return total;
    }
}

public class Main {
    public static void main(String[] args) {
        HitCounter c = new HitCounter();
        c.hit(1);
        c.hit(2);
        c.hit(2);
        System.out.println(c.getHits(4));
        c.hit(300);
        for (int t : new int[] {300, 301, 302, 1000}) System.out.print(c.getHits(t) + " ");
        System.out.println();
    }
}
