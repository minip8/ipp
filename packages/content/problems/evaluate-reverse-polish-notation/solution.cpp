#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    int evalRPN(vector<string>& tokens) {
        vector<long long> stack;
        for (const string& tok : tokens) {
            if (tok.size() == 1 && string("+-*/").find(tok[0]) != string::npos) {
                long long b = stack.back(); stack.pop_back();
                long long a = stack.back(); stack.pop_back();
                switch (tok[0]) {
                    case '+': stack.push_back(a + b); break;
                    case '-': stack.push_back(a - b); break;
                    case '*': stack.push_back(a * b); break;
                    default:  stack.push_back(a / b); break;  // C++ division truncates toward zero
                }
            } else {
                stack.push_back(stoll(tok));
            }
        }
        return (int)stack.back();
    }
};

int main() {
    Solution s;
    vector<string> t{"3", "4", "+", "2", "*"};
    cout << s.evalRPN(t) << '\n';  // 14
    return 0;
}
