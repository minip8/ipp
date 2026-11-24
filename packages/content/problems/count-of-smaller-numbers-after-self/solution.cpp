#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    vector<int> countSmaller(vector<int>& nums) {
        const int offset = 10001, size = 20002;  // values -> 1..20001
        vector<int> tree(size + 1, 0), out(nums.size());
        for (int i = (int)nums.size() - 1; i >= 0; --i) {
            int v = nums[i] + offset, count = 0;
            for (int j = v - 1; j > 0; j -= j & -j) count += tree[j];
            out[i] = count;
            for (; v <= size; v += v & -v) ++tree[v];
        }
        return out;
    }
};

int main() {
    Solution s;
    vector<int> v{5, 2, 6, 1};
    for (int x : s.countSmaller(v)) cout << x << ' ';
    cout << '\n';
    return 0;
}
