#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    int maxProfit(vector<int>& prices) {
        int best = 0, low = prices[0];
        for (int p : prices) {
            low = min(low, p);
            best = max(best, p - low);
        }
        return best;
    }
};

int main() {
    Solution s;
    vector<int> v{8, 3, 6, 1, 5, 4};
    cout << s.maxProfit(v) << '\n';  // 4
    return 0;
}
