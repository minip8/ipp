import java.util.*;

class KthLargest {
    private final int k;
    private final PriorityQueue<Integer> heap = new PriorityQueue<>();

    public KthLargest(int k, int[] nums) {
        this.k = k;
        for (int x : nums) add(x);
    }

    public int add(int val) {
        heap.offer(val);
        if (heap.size() > k) heap.poll();
        return heap.peek();
    }
}

public class Main {
    public static void main(String[] args) {
        KthLargest t = new KthLargest(3, new int[] {6, 1, 9, 4});
        for (int v : new int[] {2, 7, 10, 7, 0}) System.out.print(t.add(v) + " ");
        System.out.println();
    }
}
