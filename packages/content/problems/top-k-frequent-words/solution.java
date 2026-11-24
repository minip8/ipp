import java.util.*;

class Solution {
    public List<String> topKFrequent(List<String> words, int k) {
        Map<String, Integer> counts = new HashMap<>();
        for (String w : words) counts.merge(w, 1, Integer::sum);
        // Root = weakest: lower count first, then alphabetically larger first.
        PriorityQueue<String> heap = new PriorityQueue<>((a, b) -> {
            int ca = counts.get(a), cb = counts.get(b);
            return ca != cb ? Integer.compare(ca, cb) : b.compareTo(a);
        });
        for (String w : counts.keySet()) {
            heap.add(w);
            if (heap.size() > k) heap.poll();
        }
        List<String> out = new ArrayList<>();
        while (!heap.isEmpty()) out.add(heap.poll());
        Collections.reverse(out);
        return out;
    }
}

public class Main {
    public static void main(String[] args) {
        System.out.println(new Solution().topKFrequent(List.of("b", "a", "c", "b", "a", "c", "d"), 2));
    }
}
