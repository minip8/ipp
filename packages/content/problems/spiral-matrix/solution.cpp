#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    vector<int> spiralOrder(vector<vector<int>>& matrix) {
        vector<int> out;
        int top = 0, bottom = (int)matrix.size() - 1, left = 0, right = (int)matrix[0].size() - 1;
        while (top <= bottom && left <= right) {
            for (int j = left; j <= right; ++j) out.push_back(matrix[top][j]);
            ++top;
            for (int i = top; i <= bottom; ++i) out.push_back(matrix[i][right]);
            --right;
            if (top <= bottom) {
                for (int j = right; j >= left; --j) out.push_back(matrix[bottom][j]);
                --bottom;
            }
            if (left <= right) {
                for (int i = bottom; i >= top; --i) out.push_back(matrix[i][left]);
                ++left;
            }
        }
        return out;
    }
};

int main() {
    Solution s;
    vector<vector<int>> m{{1, 2, 3, 4}, {5, 6, 7, 8}};
    for (int x : s.spiralOrder(m)) cout << x << ' ';
    cout << '\n';
    return 0;
}
