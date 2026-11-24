#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    long long splitArray(vector<int>& nums, int k) {
        auto partsNeeded = [&](long long cap) {
            int parts = 1;
            long long cur = 0;
            for (int x : nums) {
                if (cur + x > cap) { ++parts; cur = 0; }
                cur += x;
            }
            return parts;
        };
        long long lo = *max_element(nums.begin(), nums.end()), hi = accumulate(nums.begin(), nums.end(), 0LL);
        while (lo < hi) {
            long long mid = lo + (hi - lo) / 2;
            if (partsNeeded(mid) <= k) hi = mid;
            else lo = mid + 1;
        }
        return lo;
    }
};

int main() {
    Solution s;
    vector<int> v{7, 2, 5, 10, 8};
    cout << s.splitArray(v, 2) << '\n';  // 18
    return 0;
}
