#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    vector<int> findAnagrams(string s, string p) {
        int n = (int)s.size(), m = (int)p.size();
        vector<int> out;
        if (m > n) return out;
        array<int, 26> diff{};          // window count minus needed count, per letter
        for (char c : p) --diff[c - 'a'];
        int mismatched = 0;             // letters whose diff is non-zero
        for (int d : diff) mismatched += d != 0;
        auto bump = [&](char c, int delta) {
            int& d = diff[c - 'a'];
            if (d == 0) ++mismatched;
            d += delta;
            if (d == 0) --mismatched;
        };
        for (int i = 0; i < n; ++i) {
            bump(s[i], +1);
            if (i >= m) bump(s[i - m], -1);
            if (i >= m - 1 && mismatched == 0) out.push_back(i - m + 1);
        }
        return out;
    }
};

int main() {
    Solution s;
    for (int i : s.findAnagrams("cbaebabacd", "abc")) cout << i << ' ';
    cout << '\n';  // 0 6
    return 0;
}
