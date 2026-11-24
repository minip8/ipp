#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    vector<int> productExceptSelf(vector<int>& nums) {
        int n = (int)nums.size();
        vector<int> answer(n, 1);
        for (int i = 1; i < n; ++i) answer[i] = answer[i - 1] * nums[i - 1];
        int suffix = 1;
        for (int i = n - 1; i >= 0; --i) {
            answer[i] *= suffix;
            suffix *= nums[i];
        }
        return answer;
    }
};

int main() {
    Solution s;
    vector<int> v{2, 3, 4, 5};
    for (int x : s.productExceptSelf(v)) cout << x << ' ';
    cout << '\n';
    return 0;
}
