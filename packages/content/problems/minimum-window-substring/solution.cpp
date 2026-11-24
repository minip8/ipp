#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    string minWindow(string s, string t) {
        array<int, 128> need{};
        for (char c : t) ++need[(unsigned char)c];
        int missing = (int)t.size(), left = 0, bestStart = 0, bestLen = INT_MAX;
        for (int right = 0; right < (int)s.size(); ++right) {
            if (need[(unsigned char)s[right]]-- > 0) --missing;
            if (missing == 0) {
                while (need[(unsigned char)s[left]] < 0) ++need[(unsigned char)s[left++]];
                if (right - left + 1 < bestLen) { bestStart = left; bestLen = right - left + 1; }
                ++need[(unsigned char)s[left++]];
                ++missing;
            }
        }
        return bestLen == INT_MAX ? "" : s.substr(bestStart, bestLen);
    }
};

int main() {
    Solution s;
    cout << s.minWindow("XADOBECODEBANC", "ABC") << '\n';  // BANC
    return 0;
}
