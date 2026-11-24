#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    string fractionToDecimal(int numerator, int denominator) {
        if (numerator == 0) return "0";
        string out;
        if ((numerator < 0) != (denominator < 0)) out += '-';
        long long num = llabs((long long)numerator), den = llabs((long long)denominator);
        out += to_string(num / den);
        long long rem = num % den;
        if (rem == 0) return out;
        out += '.';
        unordered_map<long long, size_t> seen;  // remainder -> position in out of the digit it produces
        while (rem != 0) {
            auto it = seen.find(rem);
            if (it != seen.end()) {
                out.insert(it->second, "(");
                out += ')';
                break;
            }
            seen[rem] = out.size();
            rem *= 10;
            out += char('0' + rem / den);
            rem %= den;
        }
        return out;
    }
};

int main() {
    Solution s;
    cout << s.fractionToDecimal(-22, 7) << ' ' << s.fractionToDecimal(1, 6) << ' ' << s.fractionToDecimal(INT_MIN, -1) << '\n';
    return 0;
}
