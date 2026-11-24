#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    long long mySqrt(long long x) {
        long long lo = 0, hi = min(x, 1LL << 27);  // sqrt(2^53) < 2^27, so mid * mid fits
        while (lo < hi) {
            long long mid = lo + (hi - lo + 1) / 2;
            if (mid * mid <= x) lo = mid;
            else hi = mid - 1;
        }
        return lo;
    }
};

int main() {
    Solution s;
    cout << s.mySqrt(27) << ' ' << s.mySqrt(1000000000000LL) << '\n';  // 5 1000000
    return 0;
}
