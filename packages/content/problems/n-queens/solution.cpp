#include <bits/stdc++.h>
using namespace std;

class Solution {
    int n = 0, full = 0;
    vector<int> queens;  // queens[r] = column in row r
    vector<vector<string>> res;

    // cols / d1 / d2: bit c is set if column c in the current row is attacked
    void go(int r, int cols, int d1, int d2) {
        if (r == n) {
            vector<string> board(n, string(n, '.'));
            for (int i = 0; i < n; ++i) board[i][queens[i]] = 'Q';
            res.push_back(move(board));
            return;
        }
        for (int avail = full & ~(cols | d1 | d2); avail; avail &= avail - 1) {
            int bit = avail & -avail;
            queens[r] = __builtin_ctz(bit);
            go(r + 1, cols | bit, ((d1 | bit) << 1) & full, (d2 | bit) >> 1);
        }
    }

public:
    vector<vector<string>> solveNQueens(int size) {
        n = size;
        full = (1 << n) - 1;
        queens.assign(n, 0);
        res.clear();
        go(0, 0, 0, 0);
        return res;
    }
};

int main() {
    Solution s;
    for (auto& b : s.solveNQueens(4)) {
        for (auto& row : b) cout << row << '\n';
        cout << '\n';
    }
    cout << s.solveNQueens(8).size() << " solutions for n = 8\n";  // 92
    return 0;
}
