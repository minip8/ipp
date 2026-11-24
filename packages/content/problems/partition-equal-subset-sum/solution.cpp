#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    bool canPartition(vector<int>& nums) {
        int total = accumulate(nums.begin(), nums.end(), 0);
        if (total % 2) return false;
        bitset<10001> reach;  // bit s: some subset of the items so far sums to s (max half = 10^4)
        reach[0] = 1;
        for (int x : nums) reach |= reach << x;
        return reach[total / 2];
    }
};

int main() {
    Solution s;
    vector<int> a{2, 3, 4, 5}, b{1, 2, 5};
    cout << boolalpha << s.canPartition(a) << ' ' << s.canPartition(b) << '\n';  // true false
    return 0;
}
