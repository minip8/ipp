#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    long long candy(vector<int>& ratings) {
        int n = (int)ratings.size();
        vector<long long> c(n, 1);
        for (int i = 1; i < n; ++i)
            if (ratings[i] > ratings[i - 1]) c[i] = c[i - 1] + 1;
        for (int i = n - 2; i >= 0; --i)
            if (ratings[i] > ratings[i + 1]) c[i] = max(c[i], c[i + 1] + 1);
        return accumulate(c.begin(), c.end(), 0LL);
    }
};

int main() {
    Solution s;
    vector<int> v{1, 3, 4, 5, 2};
    cout << s.candy(v) << '\n';  // 11
    return 0;
}
