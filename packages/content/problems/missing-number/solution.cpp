#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    int missingNumber(vector<int>& nums) {
        int acc = (int)nums.size();
        for (int i = 0; i < (int)nums.size(); ++i) acc ^= i ^ nums[i];
        return acc;
    }
};

int main() {
    Solution s;
    vector<int> v{3, 0, 1};
    cout << s.missingNumber(v) << '\n';  // 2
    return 0;
}
