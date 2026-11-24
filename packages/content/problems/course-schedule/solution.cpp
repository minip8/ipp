#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    bool canFinish(int numCourses, vector<vector<int>>& prerequisites) {
        vector<vector<int>> out(numCourses);
        vector<int> indeg(numCourses, 0);
        for (auto& p : prerequisites) {
            out[p[1]].push_back(p[0]);
            ++indeg[p[0]];
        }
        vector<int> ready;
        for (int i = 0; i < numCourses; ++i)
            if (indeg[i] == 0) ready.push_back(i);
        int taken = 0;
        while (!ready.empty()) {
            int u = ready.back();
            ready.pop_back();
            ++taken;
            for (int v : out[u])
                if (--indeg[v] == 0) ready.push_back(v);
        }
        return taken == numCourses;
    }
};

int main() {
    Solution s;
    vector<vector<int>> a{{1, 0}, {2, 1}}, b{{1, 0}, {0, 1}};
    cout << boolalpha << s.canFinish(3, a) << ' ' << s.canFinish(2, b) << '\n';
    return 0;
}
