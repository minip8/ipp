#include <bits/stdc++.h>
using namespace std;

class MedianFinder {
    priority_queue<int> low;                             // max-heap: smaller half
    priority_queue<int, vector<int>, greater<int>> high;  // min-heap: larger half

public:
    MedianFinder() {}

    void addNum(int num) {
        low.push(num);
        high.push(low.top());
        low.pop();
        if (high.size() > low.size()) {
            low.push(high.top());
            high.pop();
        }
    }

    double findMedian() {
        if (low.size() > high.size()) return low.top();
        return (static_cast<double>(low.top()) + high.top()) / 2.0;
    }
};

int main() {
    MedianFinder m;
    for (int x : {5, 1, 9, 2}) {
        m.addNum(x);
        cout << m.findMedian() << '\n';  // 5 3 5 3.5
    }
    return 0;
}
