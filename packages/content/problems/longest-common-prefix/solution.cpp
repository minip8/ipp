#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    string longestCommonPrefix(vector<string>& words) {
        const string& first = words[0];
        for (size_t j = 0; j < first.size(); ++j)
            for (size_t i = 1; i < words.size(); ++i)
                if (j == words[i].size() || words[i][j] != first[j]) return first.substr(0, j);
        return first;
    }
};

int main() {
    Solution s;
    vector<string> w{"interview", "internet", "interval"};
    cout << s.longestCommonPrefix(w) << '\n';  // inter
    return 0;
}
