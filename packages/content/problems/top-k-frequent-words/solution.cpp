#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    // Count, then keep a size-k heap whose top is the weakest kept word.
    vector<string> topKFrequent(vector<string>& words, int k) {
        unordered_map<string, int> counts;
        for (auto& w : words) ++counts[w];
        // "better" = higher count, or same count and alphabetically smaller.
        auto better = [](const pair<int, string>& a, const pair<int, string>& b) {
            return a.first != b.first ? a.first > b.first : a.second < b.second;
        };
        // With comparator `better`, priority_queue's top is the element that is least "better": the weakest.
        priority_queue<pair<int, string>, vector<pair<int, string>>, decltype(better)> heap(better);
        for (auto& [w, c] : counts) {
            heap.emplace(c, w);
            if ((int)heap.size() > k) heap.pop();
        }
        vector<string> out;
        while (!heap.empty()) {
            out.push_back(heap.top().second);
            heap.pop();
        }
        reverse(out.begin(), out.end());
        return out;
    }
};

int main() {
    Solution s;
    vector<string> words{"b", "a", "c", "b", "a", "c", "d"};
    for (auto& w : s.topKFrequent(words, 2)) cout << w << ' ';  // a b
    cout << '\n';
    return 0;
}
