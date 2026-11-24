import java.util.*;

class Solution {
    public List<String> generateParenthesis(int n) {
        List<String> res = new ArrayList<>();
        go(n, 0, 0, new StringBuilder(), res);
        return res;
    }

    private void go(int n, int opened, int closed, StringBuilder sb, List<String> res) {
        if (closed == n) {
            res.add(sb.toString());
            return;
        }
        if (opened < n) {
            sb.append('(');
            go(n, opened + 1, closed, sb, res);
            sb.deleteCharAt(sb.length() - 1);
        }
        if (closed < opened) {
            sb.append(')');
            go(n, opened, closed + 1, sb, res);
            sb.deleteCharAt(sb.length() - 1);
        }
    }
}

public class Main {
    public static void main(String[] args) {
        System.out.println(new Solution().generateParenthesis(3));
    }
}
