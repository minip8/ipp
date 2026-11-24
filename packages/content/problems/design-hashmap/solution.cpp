#include <bits/stdc++.h>
using namespace std;

// Open addressing with linear probing and tombstones; capacity is a power of two.
class MyHashMap {
    static constexpr long long EMPTY = -1, TOMB = -2;
    vector<long long> keys;
    vector<int> vals;
    size_t used = 0;  // live keys + tombstones
    size_t live = 0;

    size_t slot(long long key) const {
        uint64_t h = (uint64_t)key * 0x9E3779B97F4A7C15ULL;
        return (h >> 20) & (keys.size() - 1);
    }

    long long find(long long key) const {
        size_t mask = keys.size() - 1;
        for (size_t i = slot(key); keys[i] != EMPTY; i = (i + 1) & mask)
            if (keys[i] == key) return (long long)i;
        return -1;
    }

    void rehash() {
        vector<long long> ok = std::move(keys);
        vector<int> ov = std::move(vals);
        size_t cap = live * 4 >= ok.size() ? ok.size() * 2 : ok.size();
        keys.assign(cap, EMPTY);
        vals.assign(cap, 0);
        used = live = 0;
        for (size_t i = 0; i < ok.size(); ++i)
            if (ok[i] >= 0) put((int)ok[i], ov[i]);
    }

public:
    MyHashMap() : keys(16, EMPTY), vals(16, 0) {}

    void put(int key, int value) {
        long long i = find(key);
        if (i >= 0) {
            vals[i] = value;
            return;
        }
        if ((used + 1) * 2 > keys.size()) rehash();
        size_t j = slot(key), mask = keys.size() - 1;
        while (keys[j] >= 0) j = (j + 1) & mask;
        if (keys[j] == EMPTY) ++used;
        keys[j] = key;
        vals[j] = value;
        ++live;
    }

    int get(int key) {
        long long i = find(key);
        return i >= 0 ? vals[i] : -1;
    }

    void remove(int key) {
        long long i = find(key);
        if (i >= 0) {
            keys[i] = TOMB;
            --live;
        }
    }
};

int main() {
    MyHashMap m;
    m.put(3, 30);
    m.put(1003, 7);
    cout << m.get(3) << ' ' << m.get(1003) << ' ' << m.get(5) << '\n';  // 30 7 -1
    m.remove(1003);
    cout << m.get(1003) << '\n';  // -1
    return 0;
}
