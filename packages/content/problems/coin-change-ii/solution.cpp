#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    long long change(int amount, vector<int>& coins) {
        vector<long long> dp(amount + 1, 0);  // combinations using the coins seen so far
        dp[0] = 1;
        for (int c : coins)                    // coins outer: each multiset counted once
            for (int a = c; a <= amount; ++a)  // increasing: coin may be reused
                dp[a] += dp[a - c];
        return dp[amount];
    }
};

int main() {
    Solution s;
    vector<int> coins{1, 2, 5};
    cout << s.change(5, coins) << '\n';  // 4
    return 0;
}
