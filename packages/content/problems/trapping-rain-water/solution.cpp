#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    long long trap(vector<int>& height) {
        int lo = 0, hi = (int)height.size() - 1, leftMax = 0, rightMax = 0;
        long long water = 0;
        while (lo < hi) {
            if (height[lo] < height[hi]) {
                leftMax = max(leftMax, height[lo]);
                water += leftMax - height[lo++];
            } else {
                rightMax = max(rightMax, height[hi]);
                water += rightMax - height[hi--];
            }
        }
        return water;
    }
};

int main() {
    Solution s;
    vector<int> v{0, 1, 0, 2, 1, 0, 1, 3, 2, 1, 2, 1};
    cout << s.trap(v) << '\n';  // 6
    return 0;
}
