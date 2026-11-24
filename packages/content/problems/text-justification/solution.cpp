#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    vector<string> fullJustify(vector<string>& words, int maxWidth) {
        vector<string> lines;
        size_t i = 0, n = words.size();
        while (i < n) {
            size_t j = i + 1;
            int width = (int)words[i].size(), letters = width;  // width counts one space per gap
            while (j < n && width + 1 + (int)words[j].size() <= maxWidth) {
                width += 1 + (int)words[j].size();
                letters += (int)words[j].size();
                ++j;
            }
            string line;
            int gaps = (int)(j - i) - 1;
            if (j == n || gaps == 0) {
                for (size_t k = i; k < j; ++k) line += (k > i ? " " : "") + words[k];
                line.append(maxWidth - line.size(), ' ');
            } else {
                int spaces = maxWidth - letters, base = spaces / gaps, extra = spaces % gaps;
                for (size_t k = i; k < j; ++k) {
                    line += words[k];
                    if (k + 1 < j) line.append(base + ((int)(k - i) < extra ? 1 : 0), ' ');
                }
            }
            lines.push_back(std::move(line));
            i = j;
        }
        return lines;
    }
};

int main() {
    Solution s;
    vector<string> w{"We", "fix", "bugs", "fast", "and", "ship", "often."};
    for (auto& line : s.fullJustify(w, 14)) cout << '[' << line << "]\n";
    return 0;
}
