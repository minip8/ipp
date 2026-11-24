#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    bool carPooling(vector<vector<int>>& trips, int capacity) {
        vector<pair<int, int>> events;  // (position, change); drop-offs (negative) sort first on ties
        for (auto& t : trips) {
            events.emplace_back(t[1], t[0]);
            events.emplace_back(t[2], -t[0]);
        }
        sort(events.begin(), events.end());
        long long load = 0;
        for (auto& [pos, change] : events)
            if ((load += change) > capacity) return false;
        return true;
    }
};

int main() {
    Solution s;
    vector<vector<int>> t{{2, 1, 5}, {3, 3, 7}};
    cout << boolalpha << s.carPooling(t, 4) << ' ' << s.carPooling(t, 5) << '\n';  // false true
    return 0;
}
