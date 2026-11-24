#include <bits/stdc++.h>
using namespace std;

class Solution {
    int m = 0, n = 0;
    vector<vector<int>> memo;  // 0 = not computed yet

    int dfs(const vector<vector<int>>& g, int r, int c) {
        int& res = memo[r][c];
        if (res) return res;
        res = 1;
        static const int dr[] = {-1, 1, 0, 0}, dc[] = {0, 0, -1, 1};
        for (int d = 0; d < 4; ++d) {
            int nr = r + dr[d], nc = c + dc[d];
            if (nr >= 0 && nr < m && nc >= 0 && nc < n && g[nr][nc] > g[r][c])
                res = max(res, 1 + dfs(g, nr, nc));  // strictly increasing edges form a DAG: no visited set
        }
        return res;
    }

public:
    int longestIncreasingPath(vector<vector<int>>& matrix) {
        m = matrix.size();
        n = matrix[0].size();
        memo.assign(m, vector<int>(n, 0));
        int best = 0;
        for (int r = 0; r < m; ++r)
            for (int c = 0; c < n; ++c) best = max(best, dfs(matrix, r, c));
        return best;
    }
};

int main() {
    Solution s;
    vector<vector<int>> g{{7, 8, 9}, {6, 1, 2}, {5, 4, 3}};
    cout << s.longestIncreasingPath(g) << '\n';  // 9
    return 0;
}
