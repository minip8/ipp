#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    int numDecodings(string s) {
        // prev1 = ways for the prefix of length i-1, prev2 = length i-2
        int prev2 = 0, prev1 = 1;
        for (size_t i = 1; i <= s.size(); ++i) {
            int cur = s[i - 1] != '0' ? prev1 : 0;
            if (i >= 2) {
                int two = (s[i - 2] - '0') * 10 + (s[i - 1] - '0');
                if (two >= 10 && two <= 26) cur += prev2;
            }
            prev2 = prev1;
            prev1 = cur;
        }
        return prev1;
    }
};

int main() {
    Solution sol;
    cout << sol.numDecodings("226") << ' ' << sol.numDecodings("105") << ' ' << sol.numDecodings("30") << '\n';
    return 0;
}
