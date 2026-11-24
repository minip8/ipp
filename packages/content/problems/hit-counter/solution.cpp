#include <bits/stdc++.h>
using namespace std;

// 300 buckets indexed by timestamp % 300; each remembers which second it currently holds.
class HitCounter {
    static constexpr int WINDOW = 300;
    array<int, WINDOW> times{};
    array<int, WINDOW> counts{};

public:
    HitCounter() = default;

    void hit(int timestamp) {
        int i = timestamp % WINDOW;
        if (times[i] != timestamp) {
            times[i] = timestamp;
            counts[i] = 0;
        }
        ++counts[i];
    }

    int getHits(int timestamp) {
        int total = 0;
        for (int i = 0; i < WINDOW; ++i)
            if (counts[i] > 0 && times[i] > timestamp - WINDOW) total += counts[i];
        return total;
    }
};

int main() {
    HitCounter c;
    c.hit(1);
    c.hit(2);
    c.hit(2);
    cout << c.getHits(4) << '\n';  // 3
    c.hit(300);
    for (int t : {300, 301, 302, 1000}) cout << c.getHits(t) << ' ';
    cout << '\n';  // 4 3 1 0
    return 0;
}
