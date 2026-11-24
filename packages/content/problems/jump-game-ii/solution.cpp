#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    int jump(vector<int>& nums) {
        int jumps = 0, currentEnd = 0, farthest = 0;
        for (int i = 0; i + 1 < (int)nums.size(); ++i) {
            farthest = max(farthest, i + nums[i]);
            if (i == currentEnd) { ++jumps; currentEnd = farthest; }
        }
        return jumps;
    }
};

int main() {
    Solution s;
    vector<int> v{2, 3, 1, 1, 4};
    cout << s.jump(v) << '\n';  // 2
    return 0;
}
