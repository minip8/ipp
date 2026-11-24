#include <bits/stdc++.h>
using namespace std;

class MinStack {
    vector<pair<int, int>> items;  // (value, minimum at or below this entry)

public:
    MinStack() = default;

    void push(int val) {
        int m = items.empty() ? val : min(val, items.back().second);
        items.emplace_back(val, m);
    }

    void pop() { items.pop_back(); }

    int top() { return items.back().first; }

    int getMin() { return items.back().second; }
};

int main() {
    MinStack s;
    s.push(4);
    s.push(2);
    s.push(7);
    cout << s.getMin() << '\n';  // 2
    s.pop();
    s.pop();
    cout << s.getMin() << ' ' << s.top() << '\n';  // 4 4
    return 0;
}
