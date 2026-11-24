#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    vector<int> sortedSquares(vector<int>& nums) {
        int n = (int)nums.size(), lo = 0, hi = n - 1;
        vector<int> out(n);
        for (int k = n - 1; k >= 0; --k) {
            if (abs(nums[lo]) > abs(nums[hi])) { out[k] = nums[lo] * nums[lo]; ++lo; }
            else { out[k] = nums[hi] * nums[hi]; --hi; }
        }
        return out;
    }
};

int main() {
    Solution s;
    vector<int> v{-5, -2, 0, 3, 4};
    for (int x : s.sortedSquares(v)) cout << x << ' ';
    cout << '\n';
    return 0;
}
