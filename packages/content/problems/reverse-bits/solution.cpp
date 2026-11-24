#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    long long reverseBits(long long n) {
        uint32_t x = static_cast<uint32_t>(n), result = 0;
        for (int i = 0; i < 32; ++i) {
            result = (result << 1) | (x & 1u);
            x >>= 1;
        }
        return result;
    }
};

int main() {
    Solution s;
    cout << s.reverseBits(1) << ' ' << s.reverseBits(6) << '\n';  // 2147483648 1610612736
    return 0;
}
