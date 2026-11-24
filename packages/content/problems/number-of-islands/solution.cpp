#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    int numIslands(vector<string>& grid) {
        int rows = grid.size(), cols = grid[0].size();
        vector<vector<char>> seen(rows, vector<char>(cols, 0));
        const int dr[] = {1, -1, 0, 0}, dc[] = {0, 0, 1, -1};
        int count = 0;
        vector<pair<int, int>> stack;
        for (int r = 0; r < rows; ++r) {
            for (int c = 0; c < cols; ++c) {
                if (grid[r][c] != '1' || seen[r][c]) continue;
                ++count;
                seen[r][c] = 1;
                stack.push_back({r, c});
                while (!stack.empty()) {
                    auto [y, x] = stack.back();
                    stack.pop_back();
                    for (int d = 0; d < 4; ++d) {
                        int ny = y + dr[d], nx = x + dc[d];
                        if (ny >= 0 && ny < rows && nx >= 0 && nx < cols && grid[ny][nx] == '1' && !seen[ny][nx]) {
                            seen[ny][nx] = 1;
                            stack.push_back({ny, nx});
                        }
                    }
                }
            }
        }
        return count;
    }
};

int main() {
    vector<string> g{"11000", "11000", "00100", "00011"};
    cout << Solution().numIslands(g) << '\n';  // 3
    return 0;
}
