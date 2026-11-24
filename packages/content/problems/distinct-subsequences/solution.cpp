#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    int numDistinct(string s, string t) {
        const size_t k = t.size();
        if (k > s.size()) return 0;
        // Intermediate counts can exceed 64 bits, but only additions are involved and the final
        // answer is < 2^31, so unsigned (mod 2^64, well-defined) arithmetic yields it exactly.
        vector<unsigned long long> ways(k + 1, 0);  // ways[j]: forms of t[:j] from the prefix of s
        ways[0] = 1;
        for (char ch : s)
            for (size_t j = k; j >= 1; --j)  // downward: each character of s used at most once
                if (t[j - 1] == ch) ways[j] += ways[j - 1];
        return (int)ways[k];
    }
};

int main() {
    Solution sol;
    cout << sol.numDistinct("banana", "ban") << ' ' << sol.numDistinct("aaa", "aa") << '\n';  // 3 3
    return 0;
}
