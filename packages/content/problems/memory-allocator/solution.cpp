#include <bits/stdc++.h>
using namespace std;

// Free list as an ordered map start -> end (half-open, never adjacent), plus the blocks
// owned by each mID. allocate walks the free list in address order (first fit).
class Allocator {
    map<int, int> freeList;
    unordered_map<int, vector<pair<int, int>>> owned;

    void release(int s, int e) {
        auto right = freeList.lower_bound(s);
        if (right != freeList.begin()) {
            auto left = prev(right);
            if (left->second == s) {
                s = left->first;
                freeList.erase(left);
            }
        }
        if (right != freeList.end() && right->first == e) {
            e = right->second;
            freeList.erase(right);
        }
        freeList[s] = e;
    }

public:
    explicit Allocator(int n) { freeList[0] = n; }

    int allocate(int size, int mID) {
        for (auto it = freeList.begin(); it != freeList.end(); ++it) {
            auto [s, e] = *it;
            if (e - s < size) continue;
            freeList.erase(it);
            if (e - s > size) freeList[s + size] = e;
            owned[mID].push_back({s, s + size});
            return s;
        }
        return -1;
    }

    int freeMemory(int mID) {
        auto it = owned.find(mID);
        if (it == owned.end()) return 0;
        int total = 0;
        for (auto [s, e] : it->second) {
            release(s, e);
            total += e - s;
        }
        owned.erase(it);
        return total;
    }
};

int main() {
    Allocator a(10);
    cout << a.allocate(3, 1) << ' ' << a.allocate(2, 2) << ' ' << a.allocate(4, 1) << '\n';  // 0 3 5
    cout << a.freeMemory(2) << ' ' << a.allocate(3, 3) << ' ' << a.allocate(1, 3) << '\n';  // 2 -1 3
    cout << a.freeMemory(1) << ' ' << a.allocate(6, 4) << ' ' << a.freeMemory(9) << '\n';  // 7 4 0
    return 0;
}
