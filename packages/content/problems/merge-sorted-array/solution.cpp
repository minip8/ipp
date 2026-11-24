#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    vector<int> merge(vector<int>& nums1, int m, vector<int>& nums2, int n) {
        int i = m - 1, j = n - 1, w = m + n - 1;
        while (j >= 0) {
            if (i >= 0 && nums1[i] > nums2[j]) nums1[w--] = nums1[i--];
            else nums1[w--] = nums2[j--];
        }
        return nums1;
    }
};

int main() {
    Solution s;
    vector<int> a{1, 4, 7, 0, 0, 0}, b{2, 5, 6};
    for (int x : s.merge(a, 3, b, 3)) cout << x << ' ';
    cout << '\n';
    return 0;
}
