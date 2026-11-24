#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    int singleNumber(vector<int>& nums) {
        int acc = 0;
        for (int x : nums) acc ^= x;
        return acc;
    }
};

int main() {
    Solution s;
    vector<int> v{5, -2, 9, 9, 5};
    cout << s.singleNumber(v) << '\n';  // -2
    return 0;
}
