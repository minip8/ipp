#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    string decodeString(string s) {
        vector<pair<string, int>> stack;
        string cur;
        int k = 0;
        for (char c : s) {
            if (isdigit((unsigned char)c)) k = k * 10 + (c - '0');
            else if (c == '[') { stack.emplace_back(std::move(cur), k); cur.clear(); k = 0; }
            else if (c == ']') {
                auto [outer, times] = std::move(stack.back());
                stack.pop_back();
                outer.reserve(outer.size() + cur.size() * times);
                for (int i = 0; i < times; ++i) outer += cur;
                cur = std::move(outer);
            } else cur += c;
        }
        return cur;
    }
};

int main() {
    Solution s;
    cout << s.decodeString("x3[y2[z]]") << ' ' << s.decodeString("10[a]") << '\n';
    return 0;
}
