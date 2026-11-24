#include <bits/stdc++.h>
using namespace std;

class KthLargest {
    size_t k;
    priority_queue<int, vector<int>, greater<int>> heap;  // the k largest values, smallest on top

public:
    KthLargest(int k, vector<int>& nums) : k(k) {
        for (int x : nums) {
            heap.push(x);
            if (heap.size() > this->k) heap.pop();
        }
    }

    int add(int val) {
        heap.push(val);
        if (heap.size() > k) heap.pop();
        return heap.top();
    }
};

int main() {
    vector<int> nums{6, 1, 9, 4};
    KthLargest t(3, nums);
    for (int v : {2, 7, 10, 7, 0}) cout << t.add(v) << ' ';
    cout << '\n';  // 4 6 7 7 7
    return 0;
}
