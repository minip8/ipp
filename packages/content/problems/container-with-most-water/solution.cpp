#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    int maxArea(vector<int>& height) {
        int lo = 0, hi = (int)height.size() - 1, best = 0;
        while (lo < hi) {
            if (height[lo] <= height[hi]) { best = max(best, height[lo] * (hi - lo)); ++lo; }
            else { best = max(best, height[hi] * (hi - lo)); --hi; }
        }
        return best;
    }
};

int main() {
    Solution s;
    vector<int> v{2, 7, 3, 6, 4, 1};
    cout << s.maxArea(v) << '\n';  // 12
    return 0;
}
