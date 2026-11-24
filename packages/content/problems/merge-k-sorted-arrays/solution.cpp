#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    // k-way merge with a min-heap of (value, array index, position): O(N log k).
    vector<int> mergeKArrays(vector<vector<int>>& arrays) {
        using T = tuple<int, int, int>;
        priority_queue<T, vector<T>, greater<T>> heap;
        size_t total = 0;
        for (int i = 0; i < (int)arrays.size(); ++i) {
            total += arrays[i].size();
            if (!arrays[i].empty()) heap.emplace(arrays[i][0], i, 0);
        }
        vector<int> out;
        out.reserve(total);
        while (!heap.empty()) {
            auto [value, i, j] = heap.top();
            heap.pop();
            out.push_back(value);
            if (j + 1 < (int)arrays[i].size()) heap.emplace(arrays[i][j + 1], i, j + 1);
        }
        return out;
    }
};

int main() {
    Solution s;
    vector<vector<int>> a{{1, 4, 5}, {1, 3, 4}, {2, 6}};
    for (int x : s.mergeKArrays(a)) cout << x << ' ';
    cout << '\n';
    return 0;
}
