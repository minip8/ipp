#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    string alienOrder(vector<string>& words) {
        bool present[26] = {}, edge[26][26] = {};
        int indeg[26] = {};
        for (auto& w : words)
            for (char ch : w) present[ch - 'a'] = true;
        for (size_t i = 0; i + 1 < words.size(); ++i) {
            const string &a = words[i], &b = words[i + 1];
            size_t n = min(a.size(), b.size()), j = 0;
            while (j < n && a[j] == b[j]) ++j;
            if (j == n) {
                if (a.size() > b.size()) return "";
                continue;
            }
            int x = a[j] - 'a', y = b[j] - 'a';
            if (!edge[x][y]) {
                edge[x][y] = true;
                ++indeg[y];
            }
        }
        // At most 26 letters: scanning for the smallest ready letter is O(26^2) overall.
        string out;
        bool placed[26] = {};
        int total = count(begin(present), end(present), true);
        while ((int)out.size() < total) {
            int pick = -1;
            for (int c = 0; c < 26 && pick < 0; ++c)
                if (present[c] && !placed[c] && indeg[c] == 0) pick = c;
            if (pick < 0) return "";  // cycle
            placed[pick] = true;
            out += char('a' + pick);
            for (int c = 0; c < 26; ++c)
                if (edge[pick][c]) --indeg[c];
        }
        return out;
    }
};

int main() {
    Solution s;
    vector<string> a{"wrt", "wrf", "er", "ett", "rftt"}, b{"zx", "zy", "q"}, c{"abc", "ab"};
    cout << s.alienOrder(a) << ' ' << s.alienOrder(b) << " [" << s.alienOrder(c) << "]\n";
    return 0;
}
