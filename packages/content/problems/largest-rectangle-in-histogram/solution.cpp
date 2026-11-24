#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    long long largestRectangleArea(vector<int>& heights) {
        int n = (int)heights.size();
        vector<int> stack;  // indices with increasing heights
        long long best = 0;
        for (int i = 0; i <= n; ++i) {
            int h = i < n ? heights[i] : 0;  // trailing 0 flushes the stack
            while (!stack.empty() && heights[stack.back()] >= h) {
                int top = stack.back();
                stack.pop_back();
                int left = stack.empty() ? -1 : stack.back();
                best = max(best, (long long)heights[top] * (i - left - 1));
            }
            stack.push_back(i);
        }
        return best;
    }
};

int main() {
    Solution s;
    vector<int> v{2, 1, 5, 6, 2, 3};
    cout << s.largestRectangleArea(v) << '\n';  // 10
    return 0;
}
