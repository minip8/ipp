#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    int minMeetingRooms(vector<vector<int>>& intervals) {
        vector<int> starts, ends;
        for (auto& iv : intervals) { starts.push_back(iv[0]); ends.push_back(iv[1]); }
        sort(starts.begin(), starts.end());
        sort(ends.begin(), ends.end());
        int inUse = 0, best = 0;
        size_t j = 0;
        for (int s : starts) {
            while (ends[j] <= s) { --inUse; ++j; }  // every start < its own end, so j stays in range
            best = max(best, ++inUse);
        }
        return best;
    }
};

int main() {
    Solution s;
    vector<vector<int>> v{{0, 30}, {5, 10}, {15, 20}};
    cout << s.minMeetingRooms(v) << '\n';  // 2
    return 0;
}
