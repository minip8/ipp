// Used only at image build time to record class-data-sharing archives for javac and the driver.
import java.util.*;

class Solution {
    public int f(int[] a, String s) {
        List<Integer> l = new ArrayList<>();
        for (int x : a) l.add(x);
        Map<String, Integer> m = new HashMap<>();
        m.put(s, l.size());
        return m.get(s);
    }
}
