import java.util.*;

class MedianFinder {
    private final PriorityQueue<Integer> low = new PriorityQueue<>(Collections.reverseOrder());
    private final PriorityQueue<Integer> high = new PriorityQueue<>();

    public MedianFinder() {}

    public void addNum(int num) {
        low.add(num);
        high.add(low.poll());
        if (high.size() > low.size()) low.add(high.poll());
    }

    public double findMedian() {
        if (low.size() > high.size()) return low.peek();
        return ((double) low.peek() + high.peek()) / 2.0;
    }
}

public class Main {
    public static void main(String[] args) {
        MedianFinder m = new MedianFinder();
        for (int x : new int[] { 5, 1, 9, 2 }) {
            m.addNum(x);
            System.out.println(m.findMedian());
        }
    }
}
