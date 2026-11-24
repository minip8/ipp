import java.util.*;

class Solution {
    public boolean wordBreak(String s, List<String> wordDict) {
        Set<String> words = new HashSet<>(wordDict);
        int maxLen = 0;
        for (String w : wordDict) maxLen = Math.max(maxLen, w.length());
        int n = s.length();
        boolean[] ok = new boolean[n + 1];
        ok[0] = true;
        for (int i = 1; i <= n; i++)
            for (int len = 1; len <= Math.min(i, maxLen) && !ok[i]; len++)
                if (ok[i - len] && words.contains(s.substring(i - len, i))) ok[i] = true;
        return ok[n];
    }
}

public class Main {
    public static void main(String[] args) {
        Solution s = new Solution();
        System.out.println(s.wordBreak("icecreamcone", List.of("ice", "cream", "icecream", "cone")));
        System.out.println(s.wordBreak("catsandog", List.of("cats", "dog", "sand", "and", "cat")));
    }
}
