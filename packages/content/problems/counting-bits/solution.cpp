#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    vector<int> countBits(int n) {
        vector<int> ans(n + 1, 0);
        for (int i = 1; i <= n; ++i) ans[i] = ans[i >> 1] + (i & 1);
        return ans;
    }
};

int main() {
    Solution s;
    for (int x : s.countBits(6)) cout << x << ' ';
    cout << '\n';
    return 0;
}
