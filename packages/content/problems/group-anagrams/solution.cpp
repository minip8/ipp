#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    vector<vector<string>> groupAnagrams(vector<string>& words) {
        unordered_map<string, vector<string>> groups;
        for (const string& w : words) {
            string key(26, '\0');                 // per-letter counts; each count <= 100 fits in a char
            for (char c : w) ++key[c - 'a'];
            groups[key].push_back(w);
        }
        vector<vector<string>> out;
        out.reserve(groups.size());
        for (auto& [key, g] : groups) out.push_back(std::move(g));
        return out;
    }
};

int main() {
    Solution s;
    vector<string> w{"listen", "stone", "silent", "notes", "pots", "enlist"};
    for (auto& g : s.groupAnagrams(w)) {
        for (auto& x : g) cout << x << ' ';
        cout << "| ";
    }
    cout << '\n';
    return 0;
}
