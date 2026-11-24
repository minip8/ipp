#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    bool wordBreak(string s, vector<string>& wordDict) {
        unordered_set<string_view> words;
        size_t maxLen = 0;
        for (const string& w : wordDict) {
            words.insert(w);
            maxLen = max(maxLen, w.size());
        }
        const size_t n = s.size();
        string_view sv(s);
        vector<char> ok(n + 1, 0);  // ok[i]: prefix of length i can be segmented
        ok[0] = 1;
        for (size_t i = 1; i <= n; ++i)
            for (size_t L = 1; L <= min(i, maxLen) && !ok[i]; ++L)
                if (ok[i - L] && words.count(sv.substr(i - L, L))) ok[i] = 1;
        return ok[n];
    }
};

int main() {
    Solution sol;
    vector<string> d1{"ice", "cream", "icecream", "cone"}, d2{"cats", "dog", "sand", "and", "cat"};
    cout << boolalpha << sol.wordBreak("icecreamcone", d1) << ' ' << sol.wordBreak("catsandog", d2) << '\n';
    return 0;
}
