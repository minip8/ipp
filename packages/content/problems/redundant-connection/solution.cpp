#include <bits/stdc++.h>
using namespace std;

class Solution {
    vector<int> parent, rnk;

    int find(int x) {
        while (parent[x] != x) {
            parent[x] = parent[parent[x]];
            x = parent[x];
        }
        return x;
    }

public:
    vector<int> findRedundantConnection(vector<vector<int>>& edges) {
        int n = edges.size();
        parent.resize(n + 1);
        iota(parent.begin(), parent.end(), 0);
        rnk.assign(n + 1, 0);
        for (auto& e : edges) {
            int a = find(e[0]), b = find(e[1]);
            if (a == b) return e;
            if (rnk[a] < rnk[b]) swap(a, b);
            parent[b] = a;
            if (rnk[a] == rnk[b]) ++rnk[a];
        }
        return {};
    }
};

int main() {
    Solution s;
    vector<vector<int>> edges{{1, 2}, {2, 3}, {3, 4}, {1, 4}, {1, 5}};
    auto r = s.findRedundantConnection(edges);
    cout << r[0] << ' ' << r[1] << '\n';  // 1 4
    return 0;
}
