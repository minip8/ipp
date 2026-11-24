#include <bits/stdc++.h>
using namespace std;

class Solution {
    vector<string> g;
    string w;
    int R = 0, C = 0;

    bool dfs(int r, int c, size_t i) {
        if (r < 0 || c < 0 || r >= R || c >= C || g[r][c] != w[i]) return false;
        if (i + 1 == w.size()) return true;
        char saved = g[r][c];
        g[r][c] = '#';
        bool found = dfs(r + 1, c, i + 1) || dfs(r - 1, c, i + 1) || dfs(r, c + 1, i + 1) || dfs(r, c - 1, i + 1);
        g[r][c] = saved;
        return found;
    }

public:
    bool exist(vector<string>& board, string word) {
        g = board;
        w = word;
        R = g.size();
        C = g[0].size();
        if ((int)w.size() > R * C) return false;
        array<int, 128> have{}, need{};
        for (auto& row : g)
            for (char ch : row) have[(unsigned char)ch]++;
        for (char ch : w) need[(unsigned char)ch]++;
        for (int k = 0; k < 128; ++k)
            if (need[k] > have[k]) return false;
        if (have[(unsigned char)w.front()] > have[(unsigned char)w.back()]) reverse(w.begin(), w.end());
        for (int r = 0; r < R; ++r)
            for (int c = 0; c < C; ++c)
                if (dfs(r, c, 0)) return true;
        return false;
    }
};

int main() {
    Solution s;
    vector<string> b{"CAT", "XOD", "GSE"};
    cout << boolalpha << s.exist(b, "ATDOS") << ' ' << s.exist(b, "TODO") << '\n';
    return 0;
}
