#include <bits/stdc++.h>
using namespace std;

class WordDictionary {
    struct Node {
        array<int, 26> next;
        bool word = false;
        Node() { next.fill(-1); }
    };
    vector<Node> nodes;

    bool dfs(int node, const string& p, size_t i) const {
        for (; i < p.size(); ++i) {
            if (p[i] == '.') {
                for (int child : nodes[node].next)
                    if (child >= 0 && dfs(child, p, i + 1)) return true;
                return false;
            }
            node = nodes[node].next[p[i] - 'a'];
            if (node < 0) return false;
        }
        return nodes[node].word;
    }

public:
    WordDictionary() : nodes(1) {}

    void addWord(string word) {
        int cur = 0;
        for (char ch : word) {
            if (nodes[cur].next[ch - 'a'] < 0) {
                int fresh = nodes.size();
                nodes.emplace_back();
                nodes[cur].next[ch - 'a'] = fresh;
            }
            cur = nodes[cur].next[ch - 'a'];
        }
        nodes[cur].word = true;
    }

    bool search(string pattern) { return dfs(0, pattern, 0); }
};

int main() {
    WordDictionary d;
    for (string w : {"bad", "dad", "mad"}) d.addWord(w);
    cout << boolalpha << d.search("pad") << ' ' << d.search(".ad") << ' ' << d.search("b..") << ' ' << d.search("b.")
         << '\n';
    return 0;
}
