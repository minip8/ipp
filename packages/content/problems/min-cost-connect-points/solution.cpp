#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    // Dense Prim: O(n^2) time, O(n) space.
    int minCostConnectPoints(vector<vector<int>>& points) {
        int n = points.size();
        vector<long long> dist(n, LLONG_MAX);
        vector<bool> inTree(n, false);
        dist[0] = 0;
        long long total = 0;
        for (int iter = 0; iter < n; ++iter) {
            int u = -1;
            for (int v = 0; v < n; ++v)
                if (!inTree[v] && (u == -1 || dist[v] < dist[u])) u = v;
            inTree[u] = true;
            total += dist[u];
            for (int v = 0; v < n; ++v) {
                if (inTree[v]) continue;
                long long d = llabs((long long)points[v][0] - points[u][0]) + llabs((long long)points[v][1] - points[u][1]);
                dist[v] = min(dist[v], d);
            }
        }
        return (int)total;
    }
};

int main() {
    Solution s;
    vector<vector<int>> pts{{0, 0}, {2, 2}, {3, 10}, {5, 2}, {7, 0}};
    cout << s.minCostConnectPoints(pts) << '\n';  // 20
    return 0;
}
