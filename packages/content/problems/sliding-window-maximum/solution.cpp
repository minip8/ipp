#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    vector<int> maxSlidingWindow(vector<int>& nums, int k) {
        deque<int> window;  // indices; values strictly decrease front to back
        vector<int> out;
        out.reserve(nums.size() - k + 1);
        for (int i = 0; i < (int)nums.size(); ++i) {
            while (!window.empty() && nums[window.back()] <= nums[i]) window.pop_back();
            window.push_back(i);
            if (window.front() <= i - k) window.pop_front();
            if (i >= k - 1) out.push_back(nums[window.front()]);
        }
        return out;
    }
};

int main() {
    Solution s;
    vector<int> v{4, 2, 12, 3, 8, 1, 7};
    for (int x : s.maxSlidingWindow(v, 3)) cout << x << ' ';
    cout << '\n';
    return 0;
}
