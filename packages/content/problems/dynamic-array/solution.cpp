#include <bits/stdc++.h>
using namespace std;

// Raw storage owned by the class; std::vector appears only as toArray's return type.
class DynamicArray {
    int* data = nullptr;
    int n = 0;    // size
    int cap = 0;  // capacity

    void reallocate(int newCap) {
        int* nd = newCap ? new int[newCap] : nullptr;
        std::copy(data, data + n, nd);
        delete[] data;
        data = nd;
        cap = newCap;
    }

    void growForOne() {
        if (n == cap) reallocate(cap == 0 ? 1 : 2 * cap);
    }

public:
    DynamicArray() = default;
    ~DynamicArray() { delete[] data; }
    DynamicArray(const DynamicArray&) = delete;
    DynamicArray& operator=(const DynamicArray&) = delete;

    void pushBack(int value) {
        growForOne();
        data[n++] = value;
    }

    int popBack() { return n == 0 ? -1 : data[--n]; }

    int get(int index) { return index >= 0 && index < n ? data[index] : -1; }

    bool set(int index, int value) {
        if (index < 0 || index >= n) return false;
        data[index] = value;
        return true;
    }

    bool insert(int index, int value) {
        if (index < 0 || index > n) return false;
        growForOne();
        std::copy_backward(data + index, data + n, data + n + 1);
        data[index] = value;
        ++n;
        return true;
    }

    int erase(int index) {
        if (index < 0 || index >= n) return -1;
        int removed = data[index];
        std::copy(data + index + 1, data + n, data + index);
        --n;
        return removed;
    }

    int size() { return n; }

    int capacity() { return cap; }

    void reserve(int want) {
        if (want > cap) reallocate(want);
    }

    void resize(int want, int value) {
        if (want > cap) reallocate(max(want, 2 * cap));
        if (want > n) std::fill(data + n, data + want, value);
        n = want;
    }

    void shrinkToFit() {
        if (cap != n) reallocate(n);
    }

    vector<int> toArray() { return vector<int>(data, data + n); }
};

int main() {
    DynamicArray a;
    for (int v : {5, 6, 7}) a.pushBack(v);
    cout << a.capacity() << '\n';  // 4
    a.insert(0, 4);
    cout << a.erase(1) << ' ' << a.popBack() << '\n';  // 5 7
    a.shrinkToFit();
    cout << a.capacity() << '\n';  // 2
    return 0;
}
