#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    vector<int> dailyTemperatures(vector<int>& temperatures) {
        int n = (int)temperatures.size();
        vector<int> ans(n, 0), waiting;
        for (int i = 0; i < n; ++i) {
            while (!waiting.empty() && temperatures[waiting.back()] < temperatures[i]) {
                ans[waiting.back()] = i - waiting.back();
                waiting.pop_back();
            }
            waiting.push_back(i);
        }
        return ans;
    }
};

int main() {
    Solution s;
    vector<int> v{70, 68, 72, 71, 69, 75};
    for (int x : s.dailyTemperatures(v)) cout << x << ' ';
    cout << '\n';
    return 0;
}
