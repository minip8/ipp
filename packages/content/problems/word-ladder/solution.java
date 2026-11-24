import java.util.*;

class Solution {
    public int ladderLength(String beginWord, String endWord, List<String> wordList) {
        Set<String> unvisited = new HashSet<>(wordList);
        if (!unvisited.contains(endWord)) return 0;
        unvisited.remove(beginWord);
        List<String> frontier = new ArrayList<>(List.of(beginWord));
        int steps = 1;
        while (!frontier.isEmpty()) {
            steps++;
            List<String> next = new ArrayList<>();
            for (String w : frontier) {
                char[] chars = w.toCharArray();
                for (int i = 0; i < chars.length; i++) {
                    char original = chars[i];
                    for (char ch = 'a'; ch <= 'z'; ch++) {
                        if (ch == original) continue;
                        chars[i] = ch;
                        String cand = new String(chars);
                        if (unvisited.remove(cand)) {
                            if (cand.equals(endWord)) return steps;
                            next.add(cand);
                        }
                    }
                    chars[i] = original;
                }
            }
            frontier = next;
        }
        return 0;
    }
}

public class Main {
    public static void main(String[] args) {
        List<String> words = List.of("cord", "card", "ward", "warm", "word", "worm", "wore");
        System.out.println(new Solution().ladderLength("cold", "warm", words));
    }
}
