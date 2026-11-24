#include <bits/stdc++.h>
using namespace std;

class Solution {
    vector<int> parent;

    int find(int x) {
        while (parent[x] != x) {
            parent[x] = parent[parent[x]];
            x = parent[x];
        }
        return x;
    }

public:
    vector<vector<string>> accountsMerge(vector<vector<string>>& accounts) {
        int n = accounts.size();
        parent.resize(n);
        iota(parent.begin(), parent.end(), 0);
        unordered_map<string, int> owner;
        for (int i = 0; i < n; ++i) {
            for (size_t j = 1; j < accounts[i].size(); ++j) {
                auto [it, inserted] = owner.emplace(accounts[i][j], i);
                if (!inserted) {
                    int a = find(it->second), b = find(i);
                    if (a != b) parent[b] = a;
                }
            }
        }
        unordered_map<int, vector<string>> groups;
        for (auto& [email, i] : owner) groups[find(i)].push_back(email);
        vector<vector<string>> result;
        for (auto& [root, emails] : groups) {
            sort(emails.begin(), emails.end());
            vector<string> entry{accounts[root][0]};
            entry.insert(entry.end(), emails.begin(), emails.end());
            result.push_back(std::move(entry));
        }
        return result;
    }
};

int main() {
    Solution s;
    vector<vector<string>> accounts{{"Ana", "ana@x.io", "ana.k@mail.com"},
                                    {"Ben", "ben@y.org"},
                                    {"Ana", "a.k@work.net", "ana@x.io"},
                                    {"Ana", "ana2@x.io"}};
    for (auto& acc : s.accountsMerge(accounts)) {
        for (auto& x : acc) cout << x << ' ';
        cout << '\n';
    }
    return 0;
}
