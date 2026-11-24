#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    int eraseOverlapIntervals(vector<vector<int>>& intervals) {
        vector<pair<int, int>> byEnd;  // (end, start)
        byEnd.reserve(intervals.size());
        for (auto& iv : intervals) byEnd.emplace_back(iv[1], iv[0]);
        sort(byEnd.begin(), byEnd.end());
        int kept = 0;
        long long lastEnd = LLONG_MIN;
        for (auto [end, start] : byEnd) {
            if (start >= lastEnd) { ++kept; lastEnd = end; }
        }
        return (int)intervals.size() - kept;
    }
};

int main() {
    Solution s;
    vector<vector<int>> v{{1, 3}, {2, 4}, {3, 5}, {1, 5}};
    cout << s.eraseOverlapIntervals(v) << '\n';  // 2
    return 0;
}
