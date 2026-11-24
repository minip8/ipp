#include <bits/stdc++.h>
using namespace std;

class ObjectPool {
    struct Slot {
        int value = 0;
        long long gen = 0;
        bool live = false;
    };
    long long cap;
    vector<Slot> slots;    // allocated once; no allocation after construction
    vector<int> freeList;  // LIFO stack of released slots (capacity reserved up front)
    int nextFresh = 0, count = 0;

    Slot* find(long long handle) {
        if (handle < 0) return nullptr;
        Slot& s = slots[handle % cap];
        return (s.live && s.gen == handle / cap) ? &s : nullptr;
    }

public:
    explicit ObjectPool(int capacity) : cap(capacity), slots(capacity) { freeList.reserve(capacity); }

    long long acquire(int value) {
        int idx;
        if (!freeList.empty()) {
            idx = freeList.back();
            freeList.pop_back();
        } else if (nextFresh < cap) {
            idx = nextFresh++;
        } else {
            return -1;
        }
        Slot& s = slots[idx];
        s.value = value;
        s.live = true;
        ++count;
        return s.gen * cap + idx;
    }

    int get(long long handle) {
        Slot* s = find(handle);
        return s ? s->value : -1;
    }

    bool set(long long handle, int value) {
        Slot* s = find(handle);
        if (!s) return false;
        s->value = value;
        return true;
    }

    bool release(long long handle) {
        Slot* s = find(handle);
        if (!s) return false;
        s->live = false;
        ++s->gen;
        freeList.push_back(int(handle % cap));
        --count;
        return true;
    }

    int size() { return count; }
};

int main() {
    ObjectPool p(3);
    cout << p.acquire(10) << ' ' << p.acquire(20) << '\n';                 // 0 1
    cout << p.release(0) << ' ' << p.get(0) << ' ' << p.release(0) << '\n';  // 1 -1 0
    cout << p.acquire(30) << ' ' << p.get(3) << ' ' << p.acquire(40) << ' ' << p.acquire(50) << ' ' << p.size()
         << '\n';  // 3 30 2 -1 3
    return 0;
}
