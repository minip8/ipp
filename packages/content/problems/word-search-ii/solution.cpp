#include <bits/stdc++.h>
using namespace std;

class Solution {
    struct Node {
        array<int, 26> next;
        int word = -1;      // index into words, or -1
        int children = 0;   // number of live children, for pruning
        Node() { next.fill(-1); }
    };
    vector<Node> trie;
    vector<string> g;
    vector<string> found;
    const vector<string>* words = nullptr;
    int R = 0, C = 0;

    void dfs(int r, int c, int parent) {
        char ch = g[r][c];
        if (ch == '#') return;
        int node = trie[parent].next[ch - 'a'];
        if (node < 0) return;
        if (trie[node].word >= 0) {
            found.push_back((*words)[trie[node].word]);
            trie[node].word = -1;
        }
        g[r][c] = '#';
        if (r > 0) dfs(r - 1, c, node);
        if (r + 1 < R) dfs(r + 1, c, node);
        if (c > 0) dfs(r, c - 1, node);
        if (c + 1 < C) dfs(r, c + 1, node);
        g[r][c] = ch;
        if (trie[node].children == 0 && trie[node].word < 0) {  // prune exhausted branch
            trie[parent].next[ch - 'a'] = -1;
            trie[parent].children--;
        }
    }

public:
    vector<string> findWords(vector<string>& board, vector<string>& ws) {
        words = &ws;
        trie.assign(1, Node());
        for (int i = 0; i < (int)ws.size(); ++i) {
            int cur = 0;
            for (char ch : ws[i]) {
                if (trie[cur].next[ch - 'a'] < 0) {
                    int fresh = trie.size();
                    trie.emplace_back();
                    trie[cur].next[ch - 'a'] = fresh;
                    trie[cur].children++;
                }
                cur = trie[cur].next[ch - 'a'];
            }
            trie[cur].word = i;
        }
        g = board;
        R = g.size();
        C = g[0].size();
        found.clear();
        for (int r = 0; r < R; ++r)
            for (int c = 0; c < C; ++c) dfs(r, c, 0);
        return found;
    }
};

int main() {
    Solution s;
    vector<string> board{"cats", "rohe", "bnep"};
    vector<string> words{"cat", "cats", "hat", "the", "hen", "rob", "orb", "peep"};
    for (auto& w : s.findWords(board, words)) cout << w << ' ';
    cout << '\n';
    return 0;
}
