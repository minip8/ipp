#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    // Max-heap of size k keyed by squared distance: O(n log k).
    vector<vector<int>> kClosest(vector<vector<int>>& points, int k) {
        priority_queue<pair<long long, int>> heap;
        for (int i = 0; i < (int)points.size(); ++i) {
            long long d = 1LL * points[i][0] * points[i][0] + 1LL * points[i][1] * points[i][1];
            if ((int)heap.size() < k) {
                heap.emplace(d, i);
            } else if (d < heap.top().first) {
                heap.pop();
                heap.emplace(d, i);
            }
        }
        vector<vector<int>> out;
        while (!heap.empty()) {
            out.push_back(points[heap.top().second]);
            heap.pop();
        }
        return out;
    }
};

int main() {
    Solution s;
    vector<vector<int>> pts{{1, 3}, {-2, 2}, {5, -1}};
    for (auto& p : s.kClosest(pts, 2)) cout << p[0] << ',' << p[1] << ' ';
    cout << '\n';
    return 0;
}
