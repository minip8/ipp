#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    bool validPath(int n, vector<vector<int>>& edges, int source, int destination) {
        if (source == destination) return true;
        vector<vector<int>> adj(n);
        for (auto& e : edges) {
            adj[e[0]].push_back(e[1]);
            adj[e[1]].push_back(e[0]);
        }
        vector<char> seen(n, 0);
        vector<int> stack{source};
        seen[source] = 1;
        while (!stack.empty()) {
            int u = stack.back();
            stack.pop_back();
            for (int v : adj[u]) {
                if (v == destination) return true;
                if (!seen[v]) {
                    seen[v] = 1;
                    stack.push_back(v);
                }
            }
        }
        return false;
    }
};

int main() {
    Solution s;
    vector<vector<int>> a{{0, 1}, {1, 2}, {3, 3}}, b{{0, 1}, {2, 3}, {3, 4}};
    cout << boolalpha << s.validPath(4, a, 0, 2) << ' ' << s.validPath(5, b, 1, 4) << '\n';
    return 0;
}
