#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    int canCompleteCircuit(vector<int>& gas, vector<int>& cost) {
        long long total = 0, tank = 0;
        int start = 0;
        for (int i = 0; i < (int)gas.size(); ++i) {
            total += gas[i] - cost[i];
            tank += gas[i] - cost[i];
            if (tank < 0) { start = i + 1; tank = 0; }
        }
        return total < 0 ? -1 : start;
    }
};

int main() {
    Solution s;
    vector<int> g{1, 2, 3, 4, 5}, c{3, 4, 5, 1, 2};
    cout << s.canCompleteCircuit(g, c) << '\n';  // 3
    return 0;
}
