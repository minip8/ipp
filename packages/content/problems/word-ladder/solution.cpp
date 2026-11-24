#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    int ladderLength(string beginWord, string endWord, vector<string>& wordList) {
        unordered_set<string> unvisited(wordList.begin(), wordList.end());
        if (!unvisited.count(endWord)) return 0;
        unvisited.erase(beginWord);
        vector<string> frontier{beginWord};
        int steps = 1;
        while (!frontier.empty()) {
            ++steps;
            vector<string> next;
            for (string word : frontier) {
                for (size_t i = 0; i < word.size(); ++i) {
                    char original = word[i];
                    for (char ch = 'a'; ch <= 'z'; ++ch) {
                        if (ch == original) continue;
                        word[i] = ch;
                        auto it = unvisited.find(word);
                        if (it != unvisited.end()) {
                            if (word == endWord) return steps;
                            unvisited.erase(it);
                            next.push_back(word);
                        }
                    }
                    word[i] = original;
                }
            }
            frontier.swap(next);
        }
        return 0;
    }
};

int main() {
    vector<string> words{"cord", "card", "ward", "warm", "word", "worm", "wore"};
    cout << Solution().ladderLength("cold", "warm", words) << '\n';  // 5
    return 0;
}
