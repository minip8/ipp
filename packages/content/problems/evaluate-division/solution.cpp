#include <bits/stdc++.h>
using namespace std;

class Solution {
    // BFS over the ratio graph for each query: O(Q * (V + E)).
    unordered_map<string, vector<pair<string, double>>> adj;

    double query(const string& from, const string& to) {
        if (!adj.count(from) || !adj.count(to)) return -1.0;
        if (from == to) return 1.0;
        unordered_map<string, double> val{{from, 1.0}};  // val[x] = from / x
        queue<string> q;
        q.push(from);
        while (!q.empty()) {
            string u = q.front();
            q.pop();
            for (auto& [v, w] : adj[u]) {  // u / v = w
                if (val.count(v)) continue;
                val[v] = val[u] * w;
                if (v == to) return val[v];
                q.push(v);
            }
        }
        return -1.0;
    }

public:
    vector<double> calcEquation(vector<vector<string>>& equations, vector<double>& values,
                                vector<vector<string>>& queries) {
        adj.clear();
        for (size_t i = 0; i < equations.size(); ++i) {
            adj[equations[i][0]].push_back({equations[i][1], values[i]});
            adj[equations[i][1]].push_back({equations[i][0], 1.0 / values[i]});
        }
        vector<double> out;
        for (auto& q : queries) out.push_back(query(q[0], q[1]));
        return out;
    }
};

int main() {
    Solution s;
    vector<vector<string>> eq{{"usd", "eur"}, {"eur", "gbp"}};
    vector<double> vals{1.25, 1.2};
    vector<vector<string>> qs{{"usd", "gbp"}, {"gbp", "usd"}, {"x", "x"}};
    for (double d : s.calcEquation(eq, vals, qs)) cout << d << ' ';  // 1.5 0.666667 -1
    cout << '\n';
    return 0;
}
