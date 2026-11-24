#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    // Dijkstra where a path's cost is the maximum height on it.
    int swimInWater(vector<vector<int>>& grid) {
        int n = grid.size();
        vector<vector<char>> seen(n, vector<char>(n, 0));
        using T = tuple<int, int, int>;
        priority_queue<T, vector<T>, greater<T>> pq;
        pq.emplace(grid[0][0], 0, 0);
        seen[0][0] = 1;
        const int dr[] = {1, -1, 0, 0}, dc[] = {0, 0, 1, -1};
        while (!pq.empty()) {
            auto [t, r, c] = pq.top();
            pq.pop();
            if (r == n - 1 && c == n - 1) return t;
            for (int d = 0; d < 4; ++d) {
                int nr = r + dr[d], nc = c + dc[d];
                if (nr < 0 || nc < 0 || nr >= n || nc >= n || seen[nr][nc]) continue;
                seen[nr][nc] = 1;
                pq.emplace(max(t, grid[nr][nc]), nr, nc);
            }
        }
        return -1;
    }
};

int main() {
    Solution s;
    vector<vector<int>> g{{3, 0, 1}, {4, 8, 2}, {7, 6, 5}};
    cout << s.swimInWater(g) << '\n';  // 5
    return 0;
}
