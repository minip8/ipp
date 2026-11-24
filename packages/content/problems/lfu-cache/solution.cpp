#include <bits/stdc++.h>
using namespace std;

class LFUCache {
    struct Entry {
        int value, count;
        list<int>::iterator it;
    };
    int cap, minCount = 0;
    unordered_map<int, Entry> entries;
    unordered_map<int, list<int>> buckets;  // count -> keys, front = most recent use

    void touch(Entry& e) {
        auto& from = buckets[e.count];
        auto& to = buckets[e.count + 1];
        to.splice(to.begin(), from, e.it);  // iterator stays valid
        if (from.empty()) {
            buckets.erase(e.count);
            if (minCount == e.count) ++minCount;
        }
        ++e.count;
    }

public:
    explicit LFUCache(int capacity) : cap(capacity) {}

    int get(int key) {
        auto f = entries.find(key);
        if (f == entries.end()) return -1;
        touch(f->second);
        return f->second.value;
    }

    void put(int key, int value) {
        auto f = entries.find(key);
        if (f != entries.end()) {
            f->second.value = value;
            touch(f->second);
            return;
        }
        if ((int)entries.size() >= cap) {
            auto& b = buckets[minCount];
            entries.erase(b.back());
            b.pop_back();
            if (b.empty()) buckets.erase(minCount);
        }
        auto& one = buckets[1];
        one.push_front(key);
        entries[key] = {value, 1, one.begin()};
        minCount = 1;
    }
};

int main() {
    LFUCache c(2);
    c.put(1, 10);
    c.put(2, 20);
    cout << c.get(1) << '\n';  // 10
    c.put(3, 30);
    cout << c.get(2) << '\n';  // -1
    cout << c.get(3) << '\n';  // 30
    c.put(4, 40);
    cout << c.get(1) << ' ' << c.get(3) << ' ' << c.get(4) << '\n';  // -1 30 40
    return 0;
}
