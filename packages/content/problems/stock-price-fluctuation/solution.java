import java.util.*;

class StockPrice {
    private final Map<Integer, Integer> priceAt = new HashMap<>();
    private final TreeMap<Integer, Integer> counts = new TreeMap<>();  // price -> number of timestamps
    private int latest = 0;

    public StockPrice() {}

    public void update(int timestamp, int price) {
        Integer old = priceAt.put(timestamp, price);
        if (old != null) {
            if (counts.merge(old, -1, Integer::sum) == 0) counts.remove(old);
        }
        counts.merge(price, 1, Integer::sum);
        latest = Math.max(latest, timestamp);
    }

    public int current() { return priceAt.get(latest); }

    public int maximum() { return counts.lastKey(); }

    public int minimum() { return counts.firstKey(); }
}

public class Main {
    public static void main(String[] args) {
        StockPrice s = new StockPrice();
        s.update(1, 10);
        s.update(2, 5);
        System.out.println(s.current() + " " + s.maximum());
        s.update(1, 3);
        System.out.println(s.maximum());
    }
}
