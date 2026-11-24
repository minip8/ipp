#include <bits/stdc++.h>
using namespace std;

class Solution {
    static constexpr const char* KEYS[10] = {"", "", "abc", "def", "ghi", "jkl", "mno", "pqrs", "tuv", "wxyz"};
    vector<string> res;
    string buf;

    void go(const string& digits, size_t i) {
        if (i == digits.size()) {
            res.push_back(buf);
            return;
        }
        for (const char* p = KEYS[digits[i] - '0']; *p; ++p) {
            buf[i] = *p;
            go(digits, i + 1);
        }
    }

public:
    vector<string> letterCombinations(string digits) {
        res.clear();
        if (digits.empty()) return res;
        buf.assign(digits.size(), ' ');
        go(digits, 0);
        return res;
    }
};

int main() {
    Solution s;
    for (auto& w : s.letterCombinations("29")) cout << w << ' ';
    cout << '\n';
    return 0;
}
