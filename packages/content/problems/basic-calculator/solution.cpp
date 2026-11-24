#include <bits/stdc++.h>
using namespace std;

class Solution {
    const string* s = nullptr;
    size_t pos = 0;

    void skipSpaces() { while (pos < s->size() && (*s)[pos] == ' ') ++pos; }
    char peek() { skipSpaces(); return pos < s->size() ? (*s)[pos] : '\0'; }

    long long expr() {  // ['-'] term (('+' | '-') term)*
        bool negate = peek() == '-';
        if (negate) ++pos;
        long long value = term();
        if (negate) value = -value;
        for (char op = peek(); op == '+' || op == '-'; op = peek()) {
            ++pos;
            long long rhs = term();
            value = op == '+' ? value + rhs : value - rhs;
        }
        return value;
    }
    long long term() {  // factor (('*' | '/') factor)*
        long long value = factor();
        for (char op = peek(); op == '*' || op == '/'; op = peek()) {
            ++pos;
            long long rhs = factor();
            value = op == '*' ? value * rhs : value / rhs;  // C++ '/' truncates toward zero
        }
        return value;
    }
    long long factor() {  // number | '(' expr ')'
        if (peek() == '(') {
            ++pos;
            long long value = expr();
            peek();
            ++pos;  // ')'
            return value;
        }
        long long value = 0;
        while (pos < s->size() && isdigit((unsigned char)(*s)[pos])) value = value * 10 + ((*s)[pos++] - '0');
        return value;
    }

public:
    int calculate(string str) {
        s = &str;
        pos = 0;
        return (int)expr();
    }
};

int main() {
    Solution s;
    cout << s.calculate("2*(3+(4-10)/4)") << ' ' << s.calculate("-(5 - 12) / 2") << ' ' << s.calculate("100 - 2 * 3 - 4") << '\n';
    return 0;
}
