#include <bits/stdc++.h>
using namespace std;

class SnapshotArray {
    vector<vector<pair<int, int>>> hist;  // per index: (snap id at write time, value), ids non-decreasing
    int snapCount = 0;

public:
    explicit SnapshotArray(int length) : hist(length, vector<pair<int, int>>{{0, 0}}) {}

    void set(int index, int val) {
        auto& h = hist[index];
        if (h.back().first == snapCount) h.back().second = val;
        else h.emplace_back(snapCount, val);
    }

    int snap() { return snapCount++; }

    int get(int index, int snapId) {
        const auto& h = hist[index];
        // first entry with id > snapId; the one before it is the answer (entry 0 has id 0)
        auto it = upper_bound(h.begin(), h.end(), snapId, [](int s, const pair<int, int>& e) { return s < e.first; });
        return prev(it)->second;
    }
};

int main() {
    SnapshotArray a(3);
    a.set(0, 5);
    cout << a.snap() << '\n';  // 0
    a.set(0, 6);
    a.set(2, 1);
    int s1 = a.snap(), s2 = a.snap();
    cout << s1 << ' ' << s2 << '\n';  // 1 2
    cout << a.get(0, 0) << ' ' << a.get(0, 1) << ' ' << a.get(2, 0) << ' ' << a.get(2, 2) << ' ' << a.get(1, 2) << '\n';
    return 0;
}
