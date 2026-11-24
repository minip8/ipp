#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    vector<vector<int>> floodFill(vector<vector<int>>& image, int sr, int sc, int color) {
        vector<vector<int>> out = image;
        int old = out[sr][sc];
        if (old == color) return out;
        int rows = out.size(), cols = out[0].size();
        const int dr[] = {1, -1, 0, 0}, dc[] = {0, 0, 1, -1};
        vector<pair<int, int>> stack{{sr, sc}};
        out[sr][sc] = color;
        while (!stack.empty()) {
            auto [r, c] = stack.back();
            stack.pop_back();
            for (int d = 0; d < 4; ++d) {
                int nr = r + dr[d], nc = c + dc[d];
                if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && out[nr][nc] == old) {
                    out[nr][nc] = color;
                    stack.push_back({nr, nc});
                }
            }
        }
        return out;
    }
};

int main() {
    vector<vector<int>> img{{1, 1, 0}, {1, 0, 2}, {1, 1, 1}};
    for (auto& row : Solution().floodFill(img, 0, 0, 5)) {
        for (int x : row) cout << x << ' ';
        cout << '\n';
    }
    return 0;
}
