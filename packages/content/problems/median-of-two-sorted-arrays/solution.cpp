#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    double findMedianSortedArrays(vector<int>& x, vector<int>& y) {
        const vector<int>& a = x.size() <= y.size() ? x : y;
        const vector<int>& b = x.size() <= y.size() ? y : x;
        int m = (int)a.size(), n = (int)b.size(), half = (m + n + 1) / 2, lo = 0, hi = m;
        const long long NEG = LLONG_MIN, POS = LLONG_MAX;
        while (true) {
            int i = (lo + hi) / 2, j = half - i;
            long long aLeft = i > 0 ? a[i - 1] : NEG, aRight = i < m ? a[i] : POS;
            long long bLeft = j > 0 ? b[j - 1] : NEG, bRight = j < n ? b[j] : POS;
            if (aLeft > bRight) hi = i - 1;
            else if (bLeft > aRight) lo = i + 1;
            else {
                long long leftMax = max(aLeft, bLeft);
                if ((m + n) % 2) return (double)leftMax;
                return (leftMax + min(aRight, bRight)) / 2.0;
            }
        }
    }
};

int main() {
    Solution s;
    vector<int> a{1, 2}, b{3, 4}, c{}, d{7};
    cout << s.findMedianSortedArrays(a, b) << ' ' << s.findMedianSortedArrays(c, d) << '\n';  // 2.5 7
    return 0;
}
