#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    int subarraySum(vector<int>& nums, int k) {
        unordered_map<long long, int> seen{{0, 1}};
        seen.reserve(nums.size() * 2 + 1);
        long long prefix = 0;
        int count = 0;
        for (int x : nums) {
            prefix += x;
            auto it = seen.find(prefix - k);
            if (it != seen.end()) count += it->second;
            ++seen[prefix];
        }
        return count;
    }
};

int main() {
    Solution s;
    vector<int> v{1, 2, 3, -2, 2};
    cout << s.subarraySum(v, 3) << '\n';  // 4
    return 0;
}
