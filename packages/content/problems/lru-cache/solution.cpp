#include <bits/stdc++.h>
using namespace std;

class LRUCache {
    int cap;
    list<pair<int, int>> items;  // front = most recently used
    unordered_map<int, list<pair<int, int>>::iterator> pos;

public:
    explicit LRUCache(int capacity) : cap(capacity) { pos.reserve(capacity * 2); }

    int get(int key) {
        auto it = pos.find(key);
        if (it == pos.end()) return -1;
        items.splice(items.begin(), items, it->second);
        return it->second->second;
    }

    void put(int key, int value) {
        auto it = pos.find(key);
        if (it != pos.end()) {
            it->second->second = value;
            items.splice(items.begin(), items, it->second);
            return;
        }
        items.emplace_front(key, value);
        pos[key] = items.begin();
        if ((int)items.size() > cap) {
            pos.erase(items.back().first);
            items.pop_back();
        }
    }
};

int main() {
    LRUCache c(2);
    c.put(1, 10);
    c.put(2, 20);
    cout << c.get(1) << '\n';  // 10
    c.put(3, 30);
    cout << c.get(2) << '\n';  // -1
    return 0;
}
