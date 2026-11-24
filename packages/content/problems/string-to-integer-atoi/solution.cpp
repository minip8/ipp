#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    int myAtoi(string s) {
        size_t i = 0, n = s.size();
        while (i < n && s[i] == ' ') ++i;
        bool negative = false;
        if (i < n && (s[i] == '+' || s[i] == '-')) negative = s[i++] == '-';
        int result = 0;  // accumulated as a non-positive number so INT_MIN is representable
        while (i < n && isdigit((unsigned char)s[i])) {
            int d = s[i++] - '0';
            if (result < (INT_MIN + d) / 10) return negative ? INT_MIN : INT_MAX;
            result = result * 10 - d;
        }
        if (negative) return result;
        return result == INT_MIN ? INT_MAX : -result;
    }
};

int main() {
    Solution s;
    cout << s.myAtoi("   -0042xyz") << ' ' << s.myAtoi("-91283472332") << ' ' << s.myAtoi("2147483648") << '\n';
    return 0;
}
