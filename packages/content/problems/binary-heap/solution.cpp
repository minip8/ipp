#include <bits/stdc++.h>
using namespace std;

// Max-heap in a vector used only as growable storage (no <algorithm> heap functions).
class BinaryHeap {
    static constexpr int EMPTY = INT_MIN;
    vector<int> a;

    void siftUp(size_t i) {
        while (i > 0) {
            size_t p = (i - 1) / 2;
            if (a[i] <= a[p]) break;
            swap(a[i], a[p]);
            i = p;
        }
    }

    void siftDown(size_t i) {
        size_t n = a.size();
        while (true) {
            size_t c = 2 * i + 1;
            if (c >= n) return;
            if (c + 1 < n && a[c + 1] > a[c]) ++c;
            if (a[c] <= a[i]) return;
            swap(a[i], a[c]);
            i = c;
        }
    }

public:
    BinaryHeap() = default;

    void push(int value) {
        a.push_back(value);
        siftUp(a.size() - 1);
    }

    int pop() {
        if (a.empty()) return EMPTY;
        int top = a[0];
        a[0] = a.back();
        a.pop_back();
        if (!a.empty()) siftDown(0);
        return top;
    }

    int top() { return a.empty() ? EMPTY : a[0]; }

    int size() { return (int)a.size(); }

    void build(vector<int> values) {
        a = std::move(values);
        for (size_t i = a.size() / 2; i-- > 0;) siftDown(i);
    }

    int replaceTop(int value) {
        if (a.empty()) {
            a.push_back(value);
            return EMPTY;
        }
        int top = a[0];
        a[0] = value;
        siftDown(0);
        return top;
    }

    vector<int> toArray() { return a; }
};

int main() {
    BinaryHeap h;
    for (int v : {3, 8, 5, 9}) h.push(v);
    cout << h.pop() << '\n';         // 9
    cout << h.replaceTop(1) << '\n'; // 8
    h.build({1, 2, 3, 4, 5});
    for (int v : h.toArray()) cout << v << ' ';  // 5 4 3 1 2
    cout << '\n';
    return 0;
}
