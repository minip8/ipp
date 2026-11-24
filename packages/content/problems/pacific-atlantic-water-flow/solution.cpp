#include <bits/stdc++.h>
using namespace std;

class Solution {
    int rows = 0, cols = 0;

    vector<vector<char>> climb(const vector<vector<int>>& h, vector<pair<int, int>> stack) {
        vector<vector<char>> seen(rows, vector<char>(cols, 0));
        for (auto [r, c] : stack) seen[r][c] = 1;
        const int dr[] = {1, -1, 0, 0}, dc[] = {0, 0, 1, -1};
        while (!stack.empty()) {
            auto [r, c] = stack.back();
            stack.pop_back();
            for (int d = 0; d < 4; ++d) {
                int nr = r + dr[d], nc = c + dc[d];
                if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && !seen[nr][nc] && h[nr][nc] >= h[r][c]) {
                    seen[nr][nc] = 1;
                    stack.push_back({nr, nc});
                }
            }
        }
        return seen;
    }

public:
    vector<vector<int>> pacificAtlantic(vector<vector<int>>& heights) {
        rows = heights.size();
        cols = heights[0].size();
        vector<pair<int, int>> pac, atl;
        for (int c = 0; c < cols; ++c) pac.push_back({0, c}), atl.push_back({rows - 1, c});
        for (int r = 0; r < rows; ++r) pac.push_back({r, 0}), atl.push_back({r, cols - 1});
        auto p = climb(heights, pac), a = climb(heights, atl);
        vector<vector<int>> out;
        for (int r = 0; r < rows; ++r)
            for (int c = 0; c < cols; ++c)
                if (p[r][c] && a[r][c]) out.push_back({r, c});
        return out;
    }
};

int main() {
    vector<vector<int>> h{{1, 2, 3}, {8, 9, 4}, {7, 6, 5}};
    for (auto& cell : Solution().pacificAtlantic(h)) cout << '[' << cell[0] << ',' << cell[1] << "] ";
    cout << '\n';
    return 0;
}
