#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    vector<vector<int>> threeSum(vector<int>& input) {
        vector<int> nums(input);
        sort(nums.begin(), nums.end());
        int n = (int)nums.size();
        vector<vector<int>> out;
        for (int i = 0; i + 2 < n && nums[i] <= 0; ++i) {
            if (i > 0 && nums[i] == nums[i - 1]) continue;
            int lo = i + 1, hi = n - 1;
            while (lo < hi) {
                int s = nums[i] + nums[lo] + nums[hi];
                if (s < 0) ++lo;
                else if (s > 0) --hi;
                else {
                    out.push_back({nums[i], nums[lo], nums[hi]});
                    ++lo; --hi;
                    while (lo < hi && nums[lo] == nums[lo - 1]) ++lo;
                    while (lo < hi && nums[hi] == nums[hi + 1]) --hi;
                }
            }
        }
        return out;
    }
};

int main() {
    Solution s;
    vector<int> v{-2, 0, 1, 1, 2, -1};
    for (auto& t : s.threeSum(v)) cout << '[' << t[0] << ',' << t[1] << ',' << t[2] << "] ";
    cout << '\n';
    return 0;
}
