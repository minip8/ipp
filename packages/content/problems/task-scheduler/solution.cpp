#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    int leastInterval(vector<char>& tasks, int n) {
        array<int, 26> counts{};
        for (char t : tasks) ++counts[t - 'A'];
        int top = *max_element(counts.begin(), counts.end());
        int ties = (int)count(counts.begin(), counts.end(), top);
        return max((int)tasks.size(), (top - 1) * (n + 1) + ties);
    }
};

int main() {
    Solution s;
    vector<char> t{'A', 'A', 'A', 'B', 'B', 'B'};
    cout << s.leastInterval(t, 2) << '\n';  // 8
    return 0;
}
