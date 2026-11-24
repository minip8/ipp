#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    int maximalSquare(vector<string>& matrix) {
        const int cols = matrix[0].size();
        vector<int> prev(cols + 1, 0), cur(cols + 1, 0);  // shifted by one column; index 0 is a border
        int best = 0;
        for (const string& row : matrix) {
            for (int c = 1; c <= cols; ++c) {
                cur[c] = row[c - 1] == '1' ? 1 + min({prev[c], cur[c - 1], prev[c - 1]}) : 0;
                best = max(best, cur[c]);
            }
            swap(prev, cur);
        }
        return best * best;
    }
};

int main() {
    Solution s;
    vector<string> m{"10100", "10111", "11111", "10010"};
    cout << s.maximalSquare(m) << '\n';  // 4
    return 0;
}
