#include <bits/stdc++.h>
using namespace std;

class BrowserHistory {
    vector<string> pages;  // entries after `last` are stale
    int cur = 0, last = 0;

public:
    explicit BrowserHistory(string homepage) : pages{std::move(homepage)} {}

    void visit(string url) {
        ++cur;
        if (cur == (int)pages.size()) pages.push_back(std::move(url));
        else pages[cur] = std::move(url);
        last = cur;
    }

    string back(int steps) {
        cur = max(0, cur - steps);
        return pages[cur];
    }

    string forward(int steps) {
        cur = min(last, cur + steps);
        return pages[cur];
    }
};

int main() {
    BrowserHistory b("home.io");
    b.visit("a.io");
    b.visit("b.io");
    b.visit("c.io");
    cout << b.back(1) << ' ' << b.back(1) << ' ' << b.forward(1) << '\n';  // b.io a.io b.io
    b.visit("d.io");
    cout << b.forward(2) << ' ' << b.back(2) << ' ' << b.back(7) << '\n';  // d.io a.io home.io
    return 0;
}
