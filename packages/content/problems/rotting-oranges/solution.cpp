#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    int orangesRotting(vector<vector<int>>& grid) {
        int rows = grid.size(), cols = grid[0].size();
        vector<vector<int>> g = grid;
        vector<pair<int, int>> frontier;
        int fresh = 0;
        for (int r = 0; r < rows; ++r)
            for (int c = 0; c < cols; ++c) {
                if (g[r][c] == 2) frontier.push_back({r, c});
                if (g[r][c] == 1) ++fresh;
            }
        const int dr[] = {1, -1, 0, 0}, dc[] = {0, 0, 1, -1};
        int minutes = 0;
        while (!frontier.empty() && fresh > 0) {
            vector<pair<int, int>> next;
            for (auto [r, c] : frontier)
                for (int d = 0; d < 4; ++d) {
                    int nr = r + dr[d], nc = c + dc[d];
                    if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && g[nr][nc] == 1) {
                        g[nr][nc] = 2;
                        --fresh;
                        next.push_back({nr, nc});
                    }
                }
            frontier.swap(next);
            ++minutes;
        }
        return fresh ? -1 : minutes;
    }
};

int main() {
    vector<vector<int>> g{{2, 1, 1}, {1, 1, 0}, {0, 1, 1}};
    cout << Solution().orangesRotting(g) << '\n';  // 4
    return 0;
}
