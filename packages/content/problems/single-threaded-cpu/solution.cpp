#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    vector<int> getOrder(vector<vector<int>>& tasks) {
        int n = tasks.size();
        vector<int> order(n);
        iota(order.begin(), order.end(), 0);
        sort(order.begin(), order.end(), [&](int a, int b) { return tasks[a][0] < tasks[b][0]; });
        using P = pair<int, int>;  // (processingTime, index)
        priority_queue<P, vector<P>, greater<P>> heap;
        vector<int> out;
        out.reserve(n);
        long long clock = 0;
        int j = 0;
        while ((int)out.size() < n) {
            if (heap.empty() && clock < tasks[order[j]][0]) clock = tasks[order[j]][0];
            while (j < n && tasks[order[j]][0] <= clock) {
                heap.emplace(tasks[order[j]][1], order[j]);
                ++j;
            }
            auto [proc, i] = heap.top();
            heap.pop();
            out.push_back(i);
            clock += proc;
        }
        return out;
    }
};

int main() {
    Solution s;
    vector<vector<int>> t{{1, 3}, {2, 1}, {3, 2}, {4, 1}};
    for (int i : s.getOrder(t)) cout << i << ' ';  // 0 1 3 2
    cout << '\n';
    return 0;
}
