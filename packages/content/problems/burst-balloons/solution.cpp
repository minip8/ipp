#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    int maxCoins(vector<int>& nums) {
        vector<int> a;
        a.reserve(nums.size() + 2);
        a.push_back(1);
        a.insert(a.end(), nums.begin(), nums.end());
        a.push_back(1);
        const int n = a.size();
        // best[i][j]: coins from bursting every balloon strictly between i and j
        vector<vector<int>> best(n, vector<int>(n, 0));
        for (int len = 2; len < n; ++len)
            for (int i = 0; i + len < n; ++i) {
                int j = i + len, top = 0;
                for (int k = i + 1; k < j; ++k)  // k is the last balloon burst in (i, j)
                    top = max(top, best[i][k] + a[i] * a[k] * a[j] + best[k][j]);
                best[i][j] = top;
            }
        return best[0][n - 1];
    }
};

int main() {
    Solution s;
    vector<int> v{4, 1, 6, 2};
    cout << s.maxCoins(v) << '\n';  // 84
    return 0;
}
