#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    bool isMatch(string s, string p) {
        const int n = s.size(), m = p.size();
        // M[i][j]: suffix s[i:] matches suffix p[j:]
        vector<vector<char>> M(n + 1, vector<char>(m + 1, 0));
        M[n][m] = 1;
        for (int i = n; i >= 0; --i)
            for (int j = m - 1; j >= 0; --j) {
                if (p[j] == '*') continue;  // handled together with the element before it
                bool first = i < n && (p[j] == s[i] || p[j] == '.');
                if (j + 1 < m && p[j + 1] == '*')
                    M[i][j] = M[i][j + 2] || (first && M[i + 1][j]);  // skip "x*", or eat one char
                else
                    M[i][j] = first && M[i + 1][j + 1];
            }
        return M[0][0];
    }
};

int main() {
    Solution sol;
    cout << boolalpha << sol.isMatch("aab", "c*a*b") << ' ' << sol.isMatch("ab", ".*c") << '\n';  // true false
    return 0;
}
