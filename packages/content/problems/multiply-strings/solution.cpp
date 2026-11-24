#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    string multiply(string num1, string num2) {
        if (num1 == "0" || num2 == "0") return "0";
        int n = (int)num1.size(), m = (int)num2.size();
        vector<int> res(n + m, 0);
        for (int i = n - 1; i >= 0; --i)
            for (int j = m - 1; j >= 0; --j)
                res[i + j + 1] += (num1[i] - '0') * (num2[j] - '0');
        for (int k = n + m - 1; k > 0; --k) {
            res[k - 1] += res[k] / 10;
            res[k] %= 10;
        }
        int start = 0;
        while (res[start] == 0) ++start;
        string out;
        for (int k = start; k < n + m; ++k) out += char('0' + res[k]);
        return out;
    }
};

int main() {
    Solution s;
    cout << s.multiply("999", "999") << ' ' << s.multiply("12", "34") << '\n';  // 998001 408
    return 0;
}
