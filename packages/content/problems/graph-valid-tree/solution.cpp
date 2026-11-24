#include <bits/stdc++.h>
using namespace std;

class Solution {
    vector<int> parent;

    int find(int x) {
        while (parent[x] != x) {
            parent[x] = parent[parent[x]];
            x = parent[x];
        }
        return x;
    }

public:
    bool validTree(int n, vector<vector<int>>& edges) {
        if ((int)edges.size() != n - 1) return false;
        parent.resize(n);
        iota(parent.begin(), parent.end(), 0);
        for (auto& e : edges) {
            int a = find(e[0]), b = find(e[1]);
            if (a == b) return false;
            parent[a] = b;
        }
        return true;
    }
};

int main() {
    Solution s;
    vector<vector<int>> edges{{0, 1}, {0, 2}, {0, 3}, {1, 4}};
    cout << boolalpha << s.validTree(5, edges) << '\n';  // true
    return 0;
}
