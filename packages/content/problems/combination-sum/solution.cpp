#include <bits/stdc++.h>
using namespace std;

class Solution {
    vector<int> cands, path;
    vector<vector<int>> res;

    void go(size_t start, int remaining) {
        if (remaining == 0) {
            res.push_back(path);
            return;
        }
        for (size_t j = start; j < cands.size() && cands[j] <= remaining; ++j) {
            path.push_back(cands[j]);
            go(j, remaining - cands[j]);  // j again: reuse allowed
            path.pop_back();
        }
    }

public:
    vector<vector<int>> combinationSum(vector<int>& candidates, int target) {
        cands = candidates;
        sort(cands.begin(), cands.end());
        res.clear();
        path.clear();
        go(0, target);
        return res;
    }
};

int main() {
    Solution s;
    vector<int> c{3, 4, 7};
    for (auto& comb : s.combinationSum(c, 7)) {
        for (int x : comb) cout << x << ' ';
        cout << "| ";
    }
    cout << '\n';
    return 0;
}
