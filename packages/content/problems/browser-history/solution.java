import java.util.*;

class BrowserHistory {
    private final List<String> pages = new ArrayList<>();
    private int cur = 0, last = 0;

    public BrowserHistory(String homepage) { pages.add(homepage); }

    public void visit(String url) {
        cur++;
        if (cur == pages.size()) pages.add(url);
        else pages.set(cur, url);
        last = cur;
    }

    public String back(int steps) {
        cur = Math.max(0, cur - steps);
        return pages.get(cur);
    }

    public String forward(int steps) {
        cur = Math.min(last, cur + steps);
        return pages.get(cur);
    }
}

public class Main {
    public static void main(String[] args) {
        BrowserHistory b = new BrowserHistory("home.io");
        b.visit("a.io");
        b.visit("b.io");
        b.visit("c.io");
        System.out.println(b.back(1) + " " + b.back(1) + " " + b.forward(1));
        b.visit("d.io");
        System.out.println(b.forward(2) + " " + b.back(2) + " " + b.back(7));
    }
}
