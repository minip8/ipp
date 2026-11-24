import java.util.*;

class Solution {
    private Map<String, String> parent = new HashMap<>();
    private Map<String, Double> weight = new HashMap<>();  // x / parent(x)

    private String find(String x) {
        String p = parent.get(x);
        if (p.equals(x)) return x;
        String root = find(p);
        weight.put(x, weight.get(x) * weight.get(p));
        parent.put(x, root);
        return root;
    }

    public double[] calcEquation(List<List<String>> equations, double[] values, List<List<String>> queries) {
        for (int i = 0; i < equations.size(); i++) {
            String a = equations.get(i).get(0), b = equations.get(i).get(1);
            for (String x : new String[] {a, b}) {
                if (!parent.containsKey(x)) { parent.put(x, x); weight.put(x, 1.0); }
            }
            String ra = find(a), rb = find(b);
            if (!ra.equals(rb)) {
                parent.put(ra, rb);
                weight.put(ra, values[i] * weight.get(b) / weight.get(a));
            }
        }
        double[] out = new double[queries.size()];
        for (int j = 0; j < queries.size(); j++) {
            String c = queries.get(j).get(0), d = queries.get(j).get(1);
            if (!parent.containsKey(c) || !parent.containsKey(d) || !find(c).equals(find(d))) out[j] = -1.0;
            else out[j] = weight.get(c) / weight.get(d);
        }
        return out;
    }
}

public class Main {
    public static void main(String[] args) {
        List<List<String>> eq = List.of(List.of("usd", "eur"), List.of("eur", "gbp"));
        List<List<String>> qs = List.of(List.of("usd", "gbp"), List.of("gbp", "usd"), List.of("x", "x"));
        System.out.println(Arrays.toString(new Solution().calcEquation(eq, new double[] {1.25, 1.2}, qs)));
    }
}
