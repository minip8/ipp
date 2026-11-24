#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    int maxPoints(vector<vector<int>>& points) {
        int n = (int)points.size(), best = 1;
        for (int i = 0; i < n; ++i) {
            unordered_map<long long, int> directions;  // reduced (dx, dy) packed into one key
            for (int j = i + 1; j < n; ++j) {
                int dx = points[j][0] - points[i][0], dy = points[j][1] - points[i][1];
                int g = gcd(abs(dx), abs(dy));
                dx /= g; dy /= g;
                if (dx < 0 || (dx == 0 && dy < 0)) { dx = -dx; dy = -dy; }
                long long key = (long long)dx * 100000 + dy;  // |dy| <= 2 * 10^4 < 50000
                best = max(best, 1 + ++directions[key]);
            }
        }
        return best;
    }
};

int main() {
    Solution s;
    vector<vector<int>> p{{0, 0}, {4, 2}, {2, 1}, {1, 3}, {-2, -1}, {5, 5}};
    cout << s.maxPoints(p) << '\n';  // 4
    return 0;
}
