#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    int coinChange(vector<int>& coins, int amount) {
        const int INF = amount + 1;  // larger than any real answer
        vector<int> dp(amount + 1, INF);
        dp[0] = 0;
        for (int a = 1; a <= amount; ++a)
            for (int c : coins)
                if (c <= a) dp[a] = min(dp[a], dp[a - c] + 1);
        return dp[amount] > amount ? -1 : dp[amount];
    }
};

int main() {
    Solution s;
    vector<int> c1{1, 5, 6, 9}, c2{4, 6};
    cout << s.coinChange(c1, 11) << ' ' << s.coinChange(c2, 7) << '\n';  // 2 -1
    return 0;
}
