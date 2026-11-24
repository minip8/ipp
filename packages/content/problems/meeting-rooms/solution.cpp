#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    bool canAttendMeetings(vector<vector<int>>& intervals) {
        sort(intervals.begin(), intervals.end());
        for (size_t i = 1; i < intervals.size(); ++i)
            if (intervals[i][0] < intervals[i - 1][1]) return false;
        return true;
    }
};

int main() {
    Solution s;
    vector<vector<int>> a{{9, 10}, {13, 15}, {10, 12}}, b{{1, 5}, {8, 9}, {4, 6}};
    cout << boolalpha << s.canAttendMeetings(a) << ' ' << s.canAttendMeetings(b) << '\n';
    return 0;
}
