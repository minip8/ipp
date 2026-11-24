#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    int minEatingSpeed(vector<int>& piles, int h) {
        int lo = 1, hi = *max_element(piles.begin(), piles.end());
        while (lo < hi) {
            int k = lo + (hi - lo) / 2;
            long long hours = 0;
            for (int p : piles) hours += (p + (long long)k - 1) / k;
            if (hours <= h) hi = k;
            else lo = k + 1;
        }
        return lo;
    }
};

int main() {
    Solution s;
    vector<int> v{3, 6, 7, 11};
    cout << s.minEatingSpeed(v, 8) << '\n';  // 4
    return 0;
}
