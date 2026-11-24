#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    int longestCommonSubsequence(string text1, string text2) {
        if (text2.size() > text1.size()) swap(text1, text2);
        const size_t m = text2.size();
        vector<int> prev(m + 1, 0), cur(m + 1, 0);  // rows i-1 and i
        for (char a : text1) {
            for (size_t j = 1; j <= m; ++j)
                cur[j] = a == text2[j - 1] ? prev[j - 1] + 1 : max(prev[j], cur[j - 1]);
            swap(prev, cur);
        }
        return prev[m];
    }
};

int main() {
    Solution s;
    cout << s.longestCommonSubsequence("kitten", "sitting") << '\n';  // 4
    return 0;
}
