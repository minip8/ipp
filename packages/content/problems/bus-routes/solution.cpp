#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    // BFS over buses; each stop is expanded at most once.
    int numBusesToDestination(vector<vector<int>>& routes, int source, int target) {
        if (source == target) return 0;
        unordered_map<int, vector<int>> busesAt;
        for (int b = 0; b < (int)routes.size(); ++b)
            for (int s : routes[b]) busesAt[s].push_back(b);
        if (!busesAt.count(source) || !busesAt.count(target)) return -1;
        vector<char> busSeen(routes.size(), 0);
        unordered_set<int> stopDone{source};
        queue<pair<int, int>> q;
        for (int b : busesAt[source]) {
            busSeen[b] = 1;
            q.push({b, 1});
        }
        while (!q.empty()) {
            auto [bus, rides] = q.front();
            q.pop();
            for (int s : routes[bus]) {
                if (s == target) return rides;
                if (!stopDone.insert(s).second) continue;
                for (int nb : busesAt[s]) {
                    if (busSeen[nb]) continue;
                    busSeen[nb] = 1;
                    q.push({nb, rides + 1});
                }
            }
        }
        return -1;
    }
};

int main() {
    Solution s;
    vector<vector<int>> routes{{1, 4, 7}, {3, 6, 7}};
    cout << s.numBusesToDestination(routes, 1, 6) << '\n';  // 2
    return 0;
}
