#include <bits/stdc++.h>
using namespace std;

// All nodes live in one vector and refer to each other by index: no per-node allocation,
// no ownership questions, and the whole trie is freed by the vector's destructor.
class Trie {
    struct Node {
        array<int, 26> next;
        bool word = false;
        Node() { next.fill(-1); }
    };
    vector<Node> nodes;

    int walk(const string& s) const {
        int cur = 0;
        for (char ch : s) {
            cur = nodes[cur].next[ch - 'a'];
            if (cur < 0) return -1;
        }
        return cur;
    }

public:
    Trie() : nodes(1) {}

    void insert(string word) {
        int cur = 0;
        for (char ch : word) {
            int& nxt = nodes[cur].next[ch - 'a'];
            if (nxt < 0) {
                nxt = nodes.size();  // assign before emplace_back: the reference may dangle after it
                nodes.emplace_back();
            }
            cur = nodes[cur].next[ch - 'a'];
        }
        nodes[cur].word = true;
    }

    bool search(string word) {
        int n = walk(word);
        return n >= 0 && nodes[n].word;
    }

    bool startsWith(string prefix) { return walk(prefix) >= 0; }
};

int main() {
    Trie t;
    t.insert("card");
    cout << boolalpha << t.search("car") << ' ' << t.startsWith("car") << '\n';  // false true
    t.insert("car");
    cout << t.search("car") << ' ' << t.startsWith("cart") << '\n';  // true false
    return 0;
}
