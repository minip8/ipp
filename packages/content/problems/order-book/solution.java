import java.util.*;

class OrderBook {
    private static final class Order {
        final int id;
        final boolean buy;
        final int price;
        int qty;

        Order(int id, boolean buy, int price, int qty) {
            this.id = id;
            this.buy = buy;
            this.price = price;
            this.qty = qty;
        }
    }

    private static final class Level {
        long volume = 0;
        final LinkedHashMap<Integer, Order> queue = new LinkedHashMap<>(); // insertion order = time priority
    }

    private final TreeMap<Integer, Level> bids = new TreeMap<>(Comparator.reverseOrder());
    private final TreeMap<Integer, Level> asks = new TreeMap<>();
    private final Map<Integer, Order> resting = new HashMap<>();
    private final Set<Integer> used = new HashSet<>();
    private List<List<Integer>> fills = new ArrayList<>();

    public OrderBook() {}

    private void rest(Order o) {
        Level lvl = (o.buy ? bids : asks).computeIfAbsent(o.price, p -> new Level());
        lvl.queue.put(o.id, o);
        lvl.volume += o.qty;
        resting.put(o.id, o);
    }

    private void remove(Order o) {
        TreeMap<Integer, Level> book = o.buy ? bids : asks;
        Level lvl = book.get(o.price);
        lvl.queue.remove(o.id);
        lvl.volume -= o.qty;
        if (lvl.queue.isEmpty()) book.remove(o.price);
        resting.remove(o.id);
    }

    public int addOrder(int id, String side, int price, int qty) {
        fills = new ArrayList<>();
        if (price <= 0 || qty <= 0 || used.contains(id)) return -1;
        used.add(id);
        boolean buy = side.equals("buy");
        TreeMap<Integer, Level> other = buy ? asks : bids;
        int remaining = qty;
        while (remaining > 0 && !other.isEmpty()) {
            Map.Entry<Integer, Level> best = other.firstEntry();
            int p = best.getKey();
            if (buy ? p > price : p < price) break;
            Level lvl = best.getValue();
            Iterator<Order> it = lvl.queue.values().iterator();
            while (remaining > 0 && it.hasNext()) {
                Order o = it.next();
                int take = Math.min(remaining, o.qty);
                remaining -= take;
                o.qty -= take;
                lvl.volume -= take;
                fills.add(List.of(o.id, p, take));
                if (o.qty == 0) {
                    it.remove();
                    resting.remove(o.id);
                }
            }
            if (lvl.queue.isEmpty()) other.remove(p);
        }
        if (remaining > 0) rest(new Order(id, buy, price, remaining));
        return qty - remaining;
    }

    public boolean cancel(int id) {
        Order o = resting.get(id);
        if (o == null) return false;
        remove(o);
        return true;
    }

    public boolean modify(int id, int newQty) {
        Order o = resting.get(id);
        if (o == null || newQty <= 0) return false;
        if (newQty <= o.qty) {
            (o.buy ? bids : asks).get(o.price).volume -= o.qty - newQty;
            o.qty = newQty;
        } else {
            remove(o);
            rest(new Order(id, o.buy, o.price, newQty));
        }
        return true;
    }

    public int bestBid() {
        return bids.isEmpty() ? -1 : bids.firstKey();
    }

    public int bestAsk() {
        return asks.isEmpty() ? -1 : asks.firstKey();
    }

    public int volumeAt(String side, int price) {
        Level lvl = (side.equals("buy") ? bids : asks).get(price);
        return lvl == null ? 0 : (int) lvl.volume;
    }

    public List<List<Integer>> lastFills() {
        return fills;
    }
}

public class Main {
    public static void main(String[] args) {
        OrderBook b = new OrderBook();
        b.addOrder(1, "sell", 101, 5);
        b.addOrder(2, "sell", 100, 3);
        b.addOrder(3, "sell", 101, 4);
        System.out.println(b.addOrder(4, "buy", 101, 10) + " " + b.lastFills() + " " + b.bestAsk());
        System.out.println(b.addOrder(5, "buy", 99, 7) + " " + b.modify(5, 9) + " " + b.volumeAt("buy", 99));
    }
}
