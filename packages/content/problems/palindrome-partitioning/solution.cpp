#include <bits/stdc++.h>
using namespace std;

class Solution {
    string s;
    vector<vector<char>> pal;  // pal[i][j]: s[i..j] is a palindrome
    vector<string> path;
    vector<vector<string>> res;

    void go(int start) {
        int n = s.size();
        if (start == n) {
            res.push_back(path);
            return;
        }
        for (int end = start; end < n; ++end) {
            if (!pal[start][end]) continue;
            path.push_back(s.substr(start, end - start + 1));
            go(end + 1);
            path.pop_back();
        }
    }

public:
    vector<vector<string>> partition(string str) {
        s = str;
        int n = s.size();
        pal.assign(n, vector<char>(n, 0));
        for (int i = n - 1; i >= 0; --i)
            for (int j = i; j < n; ++j) pal[i][j] = s[i] == s[j] && (j - i < 2 || pal[i + 1][j - 1]);
        res.clear();
        path.clear();
        go(0);
        return res;
    }
};

int main() {
    Solution sol;
    for (auto& p : sol.partition("abab")) {
        for (auto& piece : p) cout << piece << '|';
        cout << ' ';
    }
    cout << '\n';
    return 0;
}
