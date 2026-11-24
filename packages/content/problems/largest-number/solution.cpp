#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    string largestNumber(vector<int>& nums) {
        vector<string> strs;
        for (int x : nums) strs.push_back(to_string(x));
        sort(strs.begin(), strs.end(), [](const string& a, const string& b) { return a + b > b + a; });
        if (strs[0] == "0") return "0";
        string out;
        for (auto& s : strs) out += s;
        return out;
    }
};

int main() {
    Solution s;
    vector<int> v{3, 30, 34, 5, 9};
    cout << s.largestNumber(v) << '\n';  // 9534330
    return 0;
}
