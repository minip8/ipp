#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    vector<vector<int>> gameOfLife(vector<vector<int>>& board) {
        int m = (int)board.size(), n = (int)board[0].size();
        for (int i = 0; i < m; ++i)
            for (int j = 0; j < n; ++j) {
                int live = 0;
                for (int di = -1; di <= 1; ++di)
                    for (int dj = -1; dj <= 1; ++dj) {
                        int r = i + di, c = j + dj;
                        if ((di || dj) && r >= 0 && r < m && c >= 0 && c < n) live += board[r][c] & 1;
                    }
                if (live == 3 || ((board[i][j] & 1) && live == 2)) board[i][j] |= 2;  // bit 1 = next generation
            }
        for (auto& row : board)
            for (int& cell : row) cell >>= 1;
        return board;
    }
};

int main() {
    Solution s;
    vector<vector<int>> b{{0, 1, 0}, {0, 1, 0}, {0, 1, 0}};
    for (auto& row : s.gameOfLife(b)) {
        for (int x : row) cout << x;
        cout << '\n';
    }
    return 0;
}
