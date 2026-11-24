#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    long long maxSubArray(vector<int>& nums) {
        long long best = nums[0], cur = nums[0];
        for (size_t i = 1; i < nums.size(); ++i) {
            cur = max<long long>(nums[i], cur + nums[i]);
            best = max(best, cur);
        }
        return best;
    }
};

int main() {
    Solution s;
    vector<int> v{3, -4, 5, -1, 2, -6, 1};
    cout << s.maxSubArray(v) << '\n';  // 6
    return 0;
}
