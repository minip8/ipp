#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    vector<vector<int>> insert(vector<vector<int>>& intervals, vector<int>& newInterval) {
        int start = newInterval[0], end = newInterval[1];
        size_t i = 0, n = intervals.size();
        vector<vector<int>> out;
        while (i < n && intervals[i][1] < start) out.push_back(intervals[i++]);
        while (i < n && intervals[i][0] <= end) {
            start = min(start, intervals[i][0]);
            end = max(end, intervals[i][1]);
            ++i;
        }
        out.push_back({start, end});
        while (i < n) out.push_back(intervals[i++]);
        return out;
    }
};

int main() {
    Solution s;
    vector<vector<int>> v{{1, 2}, {5, 7}, {9, 12}};
    vector<int> x{6, 9};
    for (auto& iv : s.insert(v, x)) cout << '[' << iv[0] << ',' << iv[1] << "] ";
    cout << '\n';
    return 0;
}
