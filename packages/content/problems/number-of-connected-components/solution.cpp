#include <bits/stdc++.h>
using namespace std;

class Solution {
    vector<int> parent, sz;

    int find(int x) {
        while (parent[x] != x) {
            parent[x] = parent[parent[x]];
            x = parent[x];
        }
        return x;
    }

public:
    int countComponents(int n, vector<vector<int>>& edges) {
        parent.resize(n);
        iota(parent.begin(), parent.end(), 0);
        sz.assign(n, 1);
        int components = n;
        for (auto& e : edges) {
            int a = find(e[0]), b = find(e[1]);
            if (a == b) continue;
            if (sz[a] < sz[b]) swap(a, b);
            parent[b] = a;
            sz[a] += sz[b];
            --components;
        }
        return components;
    }
};

int main() {
    Solution s;
    vector<vector<int>> edges{{0, 1}, {1, 2}, {4, 5}};
    cout << s.countComponents(6, edges) << '\n';  // 3
    return 0;
}
