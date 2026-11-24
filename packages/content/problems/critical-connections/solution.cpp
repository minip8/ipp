#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    vector<vector<int>> criticalConnections(int n, vector<vector<int>>& connections) {
        vector<vector<int>> adj(n);
        for (auto& c : connections) {
            adj[c[0]].push_back(c[1]);
            adj[c[1]].push_back(c[0]);
        }
        vector<int> tin(n, -1), low(n, 0);
        vector<vector<int>> bridges;
        int timer = 0;
        struct Frame { int v, parent; size_t next; };
        vector<Frame> stack;
        tin[0] = low[0] = timer++;
        stack.push_back({0, -1, 0});
        while (!stack.empty()) {
            Frame& f = stack.back();
            int v = f.v;
            if (f.next < adj[v].size()) {
                int u = adj[v][f.next++];
                if (u == f.parent) continue;
                if (tin[u] == -1) {
                    tin[u] = low[u] = timer++;
                    stack.push_back({u, v, 0});  // invalidates f; not used again this iteration
                } else {
                    low[v] = min(low[v], tin[u]);
                }
            } else {
                int parent = f.parent;
                stack.pop_back();
                if (parent != -1) {
                    low[parent] = min(low[parent], low[v]);
                    if (low[v] > tin[parent]) bridges.push_back({parent, v});
                }
            }
        }
        return bridges;
    }
};

int main() {
    vector<vector<int>> c{{0, 1}, {1, 2}, {2, 0}, {1, 3}, {3, 4}};
    for (auto& b : Solution().criticalConnections(5, c)) cout << b[0] << '-' << b[1] << ' ';
    cout << '\n';
    return 0;
}
