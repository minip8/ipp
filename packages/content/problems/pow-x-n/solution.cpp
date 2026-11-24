#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    double myPow(double x, int n) {
        long long e = n;  // 64-bit so that -(-2^31) does not overflow
        if (e < 0) { x = 1.0 / x; e = -e; }
        double result = 1.0;
        while (e) {
            if (e & 1) result *= x;
            x *= x;
            e >>= 1;
        }
        return result;
    }
};

int main() {
    Solution s;
    cout << s.myPow(2.0, 10) << ' ' << s.myPow(2.0, -2) << ' ' << s.myPow(-1.0, INT_MIN) << '\n';
    return 0;
}
