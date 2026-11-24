#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    int minDistance(string word1, string word2) {
        const int m = word2.size();
        vector<int> prev(m + 1), cur(m + 1);
        iota(prev.begin(), prev.end(), 0);  // from the empty prefix: j insertions
        for (int i = 1; i <= (int)word1.size(); ++i) {
            cur[0] = i;
            for (int j = 1; j <= m; ++j) {
                if (word1[i - 1] == word2[j - 1]) cur[j] = prev[j - 1];
                else cur[j] = 1 + min({prev[j], cur[j - 1], prev[j - 1]});  // delete, insert, replace
            }
            swap(prev, cur);
        }
        return prev[m];
    }
};

int main() {
    Solution s;
    cout << s.minDistance("sunday", "saturday") << ' ' << s.minDistance("", "abc") << '\n';  // 3 3
    return 0;
}
