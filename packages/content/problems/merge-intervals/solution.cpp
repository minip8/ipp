#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    vector<vector<int>> merge(vector<vector<int>>& intervals) {
        vector<vector<int>> sorted(intervals);
        sort(sorted.begin(), sorted.end());
        vector<vector<int>> out;
        for (auto& iv : sorted) {
            if (!out.empty() && iv[0] <= out.back()[1]) out.back()[1] = max(out.back()[1], iv[1]);
            else out.push_back(iv);
        }
        return out;
    }
};

int main() {
    Solution s;
    vector<vector<int>> v{{8, 10}, {1, 3}, {2, 6}, {15, 18}};
    for (auto& iv : s.merge(v)) cout << '[' << iv[0] << ',' << iv[1] << "] ";
    cout << '\n';
    return 0;
}
