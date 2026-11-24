import java.util.*;

class Solution {
    private static final String[] KEYS = { "", "", "abc", "def", "ghi", "jkl", "mno", "pqrs", "tuv", "wxyz" };

    public List<String> letterCombinations(String digits) {
        List<String> res = new ArrayList<>();
        if (digits.isEmpty()) return res;
        go(digits, 0, new char[digits.length()], res);
        return res;
    }

    private void go(String digits, int i, char[] buf, List<String> res) {
        if (i == digits.length()) {
            res.add(new String(buf));
            return;
        }
        for (char c : KEYS[digits.charAt(i) - '0'].toCharArray()) {
            buf[i] = c;
            go(digits, i + 1, buf, res);
        }
    }
}

public class Main {
    public static void main(String[] args) {
        System.out.println(new Solution().letterCombinations("29"));
    }
}
