#include <bits/stdc++.h>
using namespace std;

class Solution {
    vector<string> res;
    string buf;

    void go(int n, int opened, int closed) {
        if (closed == n) {
            res.push_back(buf);
            return;
        }
        if (opened < n) {
            buf.push_back('(');
            go(n, opened + 1, closed);
            buf.pop_back();
        }
        if (closed < opened) {
            buf.push_back(')');
            go(n, opened, closed + 1);
            buf.pop_back();
        }
    }

public:
    vector<string> generateParenthesis(int n) {
        res.clear();
        buf.clear();
        go(n, 0, 0);
        return res;
    }
};

int main() {
    Solution s;
    for (auto& p : s.generateParenthesis(3)) cout << p << ' ';
    cout << '\n';
    return 0;
}
