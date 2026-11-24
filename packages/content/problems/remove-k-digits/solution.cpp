#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    string removeKdigits(string num, int k) {
        string stack;
        for (char d : num) {
            while (k > 0 && !stack.empty() && stack.back() > d) { stack.pop_back(); --k; }
            stack.push_back(d);
        }
        stack.resize(stack.size() - k);
        size_t start = stack.find_first_not_of('0');
        return start == string::npos ? "0" : stack.substr(start);
    }
};

int main() {
    Solution s;
    cout << s.removeKdigits("4352", 1) << ' ' << s.removeKdigits("10200", 1) << ' ' << s.removeKdigits("10", 2) << '\n';
    return 0;
}
