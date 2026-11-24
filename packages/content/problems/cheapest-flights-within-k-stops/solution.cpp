#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    int findCheapestPrice(int n, vector<vector<int>>& flights, int src, int dst, int k) {
        const long long INF = LLONG_MAX / 4;
        vector<long long> cost(n, INF);
        cost[src] = 0;
        for (int round = 0; round <= k; ++round) {
            vector<long long> next = cost;
            bool changed = false;
            for (auto& f : flights) {
                if (cost[f[0]] + f[2] < next[f[1]]) {
                    next[f[1]] = cost[f[0]] + f[2];
                    changed = true;
                }
            }
            cost.swap(next);
            if (!changed) break;
        }
        return cost[dst] >= INF ? -1 : (int)cost[dst];
    }
};

int main() {
    vector<vector<int>> f{{0, 1, 100}, {1, 2, 100}, {2, 0, 100}, {1, 3, 600}, {2, 3, 200}};
    cout << Solution().findCheapestPrice(4, f, 0, 3, 1) << '\n';  // 700
    return 0;
}
