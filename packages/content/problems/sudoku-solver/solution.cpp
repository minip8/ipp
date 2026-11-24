#include <bits/stdc++.h>
using namespace std;

class Solution {
    vector<string> g;
    int rows[9]{}, cols[9]{}, boxes[9]{};
    vector<pair<int, int>> empty;

    static int box(int r, int c) { return r / 3 * 3 + c / 3; }

    bool solve() {
        if (empty.empty()) return true;
        // minimum remaining values: branch on the most constrained empty cell
        int bestI = -1, bestMask = 0, bestCnt = 10;
        for (int i = 0; i < (int)empty.size(); ++i) {
            auto [r, c] = empty[i];
            int mask = ~(rows[r] | cols[c] | boxes[box(r, c)]) & 0x1FF;
            int cnt = __builtin_popcount(mask);
            if (cnt < bestCnt) {
                bestI = i, bestMask = mask, bestCnt = cnt;
                if (cnt <= 1) break;
            }
        }
        if (bestCnt == 0) return false;
        auto [r, c] = empty[bestI];
        swap(empty[bestI], empty.back());
        empty.pop_back();
        int b = box(r, c);
        for (int mask = bestMask; mask; mask &= mask - 1) {
            int bit = mask & -mask;
            rows[r] |= bit, cols[c] |= bit, boxes[b] |= bit;
            if (solve()) {
                g[r][c] = char('1' + __builtin_ctz(bit));
                return true;
            }
            rows[r] ^= bit, cols[c] ^= bit, boxes[b] ^= bit;
        }
        empty.push_back({r, c});
        swap(empty[bestI], empty.back());
        return false;
    }

public:
    vector<string> solveSudoku(vector<string>& board) {
        g = board;
        fill(begin(rows), end(rows), 0);
        fill(begin(cols), end(cols), 0);
        fill(begin(boxes), end(boxes), 0);
        empty.clear();
        for (int r = 0; r < 9; ++r)
            for (int c = 0; c < 9; ++c) {
                if (g[r][c] == '.') {
                    empty.push_back({r, c});
                } else {
                    int bit = 1 << (g[r][c] - '1');
                    rows[r] |= bit, cols[c] |= bit, boxes[box(r, c)] |= bit;
                }
            }
        solve();
        return g;
    }
};

int main() {
    vector<string> puzzle{"5..3.64..", ".8.......", "63.74852.", "9..1..863", ".6348...9",
                          ".7....254", "..4.6..7.", "7.6...982", "3.....1.."};
    Solution s;
    for (auto& row : s.solveSudoku(puzzle)) cout << row << '\n';
    return 0;
}
