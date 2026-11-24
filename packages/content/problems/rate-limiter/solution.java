import java.util.*;

class RateLimiter {
    private final int max, window;
    private final Map<Integer, ArrayDeque<Integer>> log = new HashMap<>();

    public RateLimiter(int maxRequests, int windowSeconds) {
        max = maxRequests;
        window = windowSeconds;
    }

    public boolean allow(int clientId, int timestamp) {
        ArrayDeque<Integer> q = log.computeIfAbsent(clientId, k -> new ArrayDeque<>());
        while (!q.isEmpty() && q.peekFirst() <= timestamp - window) q.pollFirst();
        if (q.size() >= max) return false;
        q.addLast(timestamp);
        return true;
    }
}

public class Main {
    public static void main(String[] args) {
        RateLimiter r = new RateLimiter(2, 10);
        int[][] calls = {{1, 1}, {1, 5}, {1, 8}, {2, 8}, {1, 11}, {1, 14}, {1, 15}};
        for (int[] c : calls) System.out.print(r.allow(c[0], c[1]) + " ");
        System.out.println();
    }
}
