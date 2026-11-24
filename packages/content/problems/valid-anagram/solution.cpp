#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    bool isAnagram(string s, string t) {
        if (s.size() != t.size()) return false;
        array<int, 26> counts{};
        for (size_t i = 0; i < s.size(); ++i) {
            ++counts[s[i] - 'a'];
            --counts[t[i] - 'a'];
        }
        return all_of(counts.begin(), counts.end(), [](int c) { return c == 0; });
    }
};

int main() {
    Solution s;
    cout << boolalpha << s.isAnagram("listen", "silent") << ' ' << s.isAnagram("aab", "abb") << '\n';
    return 0;
}
