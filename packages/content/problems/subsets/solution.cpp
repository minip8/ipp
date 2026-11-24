#include <bits/stdc++.h>
using namespace std;

class Solution {
    vector<vector<int>> res;
    vector<int> cur;

    void go(const vector<int>& nums, size_t i) {
        if (i == nums.size()) {
            res.push_back(cur);
            return;
        }
        go(nums, i + 1);  // skip nums[i]
        cur.push_back(nums[i]);
        go(nums, i + 1);  // take nums[i]
        cur.pop_back();
    }

public:
    vector<vector<int>> subsets(vector<int>& nums) {
        res.clear();
        cur.clear();
        go(nums, 0);
        return res;
    }
};

int main() {
    Solution s;
    vector<int> v{1, 2, 3};
    for (auto& sub : s.subsets(v)) {
        cout << '[';
        for (size_t i = 0; i < sub.size(); ++i) cout << (i ? "," : "") << sub[i];
        cout << "] ";
    }
    cout << '\n';
    return 0;
}
