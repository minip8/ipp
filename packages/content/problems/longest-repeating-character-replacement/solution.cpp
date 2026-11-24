#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    int characterReplacement(string s, int k) {
        array<int, 26> counts{};
        int left = 0, maxf = 0, best = 0;
        for (int right = 0; right < (int)s.size(); ++right) {
            maxf = max(maxf, ++counts[s[right] - 'A']);
            while (right - left + 1 - maxf > k) --counts[s[left++] - 'A'];
            best = max(best, right - left + 1);
        }
        return best;
    }
};

int main() {
    Solution s;
    cout << s.characterReplacement("AABABBA", 1) << '\n';  // 4
    return 0;
}
