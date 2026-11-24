#include <bits/stdc++.h>
using namespace std;

// Circular buffer with a power-of-two capacity, so wrapping is a mask. std::vector appears only
// as toArray's return type.
class RingDeque {
    int* buf;
    size_t cap = 8;   // always a power of two
    size_t head = 0;  // index of the front element
    size_t n = 0;

    size_t at(size_t i) const { return (head + i) & (cap - 1); }

    void grow(size_t need) {
        if (need <= cap) return;
        size_t nc = cap;
        while (nc < need) nc *= 2;
        int* nb = new int[nc];
        for (size_t i = 0; i < n; ++i) nb[i] = buf[at(i)];  // unwrap: the front goes to 0
        delete[] buf;
        buf = nb;
        cap = nc;
        head = 0;
    }

public:
    RingDeque() : buf(new int[8]) {}
    ~RingDeque() { delete[] buf; }
    RingDeque(const RingDeque&) = delete;
    RingDeque& operator=(const RingDeque&) = delete;

    void pushFront(int value) {
        grow(n + 1);
        head = (head + cap - 1) & (cap - 1);
        buf[head] = value;
        ++n;
    }

    void pushBack(int value) {
        grow(n + 1);
        buf[at(n)] = value;
        ++n;
    }

    int popFront() {
        if (n == 0) return -1;
        int v = buf[head];
        head = at(1);
        --n;
        return v;
    }

    int popBack() {
        if (n == 0) return -1;
        --n;
        return buf[at(n)];
    }

    int front() { return n ? buf[head] : -1; }

    int back() { return n ? buf[at(n - 1)] : -1; }

    int get(int index) {
        if (index < 0 || (size_t)index >= n) return -1;
        return buf[at(index)];
    }

    int size() { return (int)n; }

    void resize(int want, int value) {
        size_t m = want;
        if (m > n) {
            grow(m);
            for (size_t i = n; i < m; ++i) buf[at(i)] = value;
        }
        n = m;
    }

    vector<int> toArray() {
        vector<int> out(n);
        for (size_t i = 0; i < n; ++i) out[i] = buf[at(i)];
        return out;
    }
};

int main() {
    RingDeque d;
    d.pushBack(2);
    d.pushBack(3);
    d.pushFront(1);
    d.pushFront(0);
    cout << d.get(1) << ' ' << d.popBack() << ' ' << d.popFront() << '\n';  // 1 3 0
    d.pushBack(9);
    d.resize(5, 4);
    for (int v : d.toArray()) cout << v << ' ';  // 1 2 9 4 4
    cout << '\n';
    return 0;
}
