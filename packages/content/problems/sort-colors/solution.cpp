#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    vector<int> sortColors(vector<int>& nums) {
        int low = 0, mid = 0, high = (int)nums.size() - 1;
        while (mid <= high) {
            if (nums[mid] == 0) swap(nums[low++], nums[mid++]);
            else if (nums[mid] == 1) ++mid;
            else swap(nums[mid], nums[high--]);
        }
        return nums;
    }
};

int main() {
    Solution s;
    vector<int> v{2, 0, 2, 1, 1, 0};
    for (int x : s.sortColors(v)) cout << x << ' ';
    cout << '\n';
    return 0;
}
