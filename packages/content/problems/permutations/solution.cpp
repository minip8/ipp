#include <bits/stdc++.h>
using namespace std;

class Solution {
    vector<vector<int>> res;

    void go(vector<int>& a, size_t i) {
        if (i == a.size()) {
            res.push_back(a);
            return;
        }
        for (size_t j = i; j < a.size(); ++j) {
            swap(a[i], a[j]);
            go(a, i + 1);
            swap(a[i], a[j]);
        }
    }

public:
    vector<vector<int>> permute(vector<int>& nums) {
        res.clear();
        vector<int> a = nums;
        go(a, 0);
        return res;
    }
};

int main() {
    Solution s;
    vector<int> v{1, 2, 3};
    for (auto& p : s.permute(v)) {
        for (int x : p) cout << x;
        cout << ' ';
    }
    cout << '\n';
    return 0;
}
