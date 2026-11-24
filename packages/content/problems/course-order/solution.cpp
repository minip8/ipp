#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    vector<int> findOrder(int numCourses, vector<vector<int>>& prerequisites) {
        vector<vector<int>> out(numCourses);
        vector<int> indeg(numCourses, 0);
        for (auto& p : prerequisites) {
            out[p[1]].push_back(p[0]);
            ++indeg[p[0]];
        }
        priority_queue<int, vector<int>, greater<int>> ready;
        for (int i = 0; i < numCourses; ++i)
            if (indeg[i] == 0) ready.push(i);
        vector<int> order;
        order.reserve(numCourses);
        while (!ready.empty()) {
            int u = ready.top();
            ready.pop();
            order.push_back(u);
            for (int v : out[u])
                if (--indeg[v] == 0) ready.push(v);
        }
        if ((int)order.size() != numCourses) order.clear();
        return order;
    }
};

int main() {
    Solution s;
    vector<vector<int>> a{{1, 0}, {2, 0}, {3, 1}, {3, 2}}, b{{0, 3}, {1, 3}};
    for (int x : s.findOrder(4, a)) cout << x << ' ';
    cout << '\n';
    for (int x : s.findOrder(4, b)) cout << x << ' ';
    cout << '\n';
    return 0;
}
