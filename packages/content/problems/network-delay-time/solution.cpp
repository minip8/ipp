#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    int networkDelayTime(vector<vector<int>>& times, int n, int k) {
        vector<vector<pair<int, int>>> adj(n + 1);
        for (auto& t : times) adj[t[0]].push_back({t[1], t[2]});
        const int INF = INT_MAX;
        vector<int> dist(n + 1, INF);
        dist[k] = 0;
        priority_queue<pair<int, int>, vector<pair<int, int>>, greater<>> pq;
        pq.push({0, k});
        while (!pq.empty()) {
            auto [d, u] = pq.top();
            pq.pop();
            if (d > dist[u]) continue;
            for (auto [v, w] : adj[u]) {
                if (d + w < dist[v]) {
                    dist[v] = d + w;
                    pq.push({dist[v], v});
                }
            }
        }
        int worst = *max_element(dist.begin() + 1, dist.end());
        return worst == INF ? -1 : worst;
    }
};

int main() {
    vector<vector<int>> t{{1, 2, 4}, {1, 3, 1}, {3, 2, 2}, {2, 4, 1}};
    cout << Solution().networkDelayTime(t, 4, 1) << '\n';  // 4
    return 0;
}
