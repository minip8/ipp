#include <bits/stdc++.h>
using namespace std;

class CircularQueue {
    vector<int> buf;
    size_t head = 0;   // index of the front element
    size_t count = 0;  // number of stored elements

public:
    explicit CircularQueue(int capacity) : buf(capacity) {}

    bool enqueue(int value) {
        if (count == buf.size()) return false;
        buf[(head + count) % buf.size()] = value;
        ++count;
        return true;
    }

    bool dequeue() {
        if (count == 0) return false;
        head = (head + 1) % buf.size();
        --count;
        return true;
    }

    int front() { return count ? buf[head] : -1; }

    int rear() { return count ? buf[(head + count - 1) % buf.size()] : -1; }

    bool isEmpty() { return count == 0; }

    bool isFull() { return count == buf.size(); }
};

int main() {
    CircularQueue q(3);
    for (int v : {1, 2, 3, 4}) cout << q.enqueue(v) << ' ';
    cout << '\n';  // 1 1 1 0
    q.dequeue();
    q.enqueue(4);
    cout << q.front() << ' ' << q.rear() << '\n';  // 2 4
    return 0;
}
