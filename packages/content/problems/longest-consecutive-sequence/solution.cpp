#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    int longestConsecutive(vector<int>& nums) {
        unordered_set<long long> values(nums.begin(), nums.end());
        int best = 0;
        for (long long v : values) {
            if (values.count(v - 1)) continue;
            long long end = v;
            while (values.count(end + 1)) ++end;
            best = max(best, int(end - v + 1));
        }
        return best;
    }
};

int main() {
    Solution s;
    vector<int> v{10, 4, 20, 1, 3, 2};
    cout << s.longestConsecutive(v) << '\n';  // 4
    return 0;
}
