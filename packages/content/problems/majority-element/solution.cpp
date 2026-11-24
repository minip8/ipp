#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    int majorityElement(vector<int>& nums) {
        int candidate = 0, count = 0;
        for (int x : nums) {
            if (count == 0) candidate = x;
            count += (x == candidate) ? 1 : -1;
        }
        return candidate;
    }
};

int main() {
    Solution s;
    vector<int> v{7, 7, 2, 2, 7, 3, 7};
    cout << s.majorityElement(v) << '\n';  // 7
    return 0;
}
