#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    int lengthOfLIS(vector<int>& nums) {
        vector<int> tails;  // tails[k] = smallest tail of an increasing subsequence of length k+1
        for (int x : nums) {
            auto it = lower_bound(tails.begin(), tails.end(), x);  // strict: lower_bound
            if (it == tails.end()) tails.push_back(x);
            else *it = x;
        }
        return (int)tails.size();
    }
};

int main() {
    Solution s;
    vector<int> v{4, 1, 8, 2, 3, 9, 5};
    cout << s.lengthOfLIS(v) << '\n';  // 4
    return 0;
}
