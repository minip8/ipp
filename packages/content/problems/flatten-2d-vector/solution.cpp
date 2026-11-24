#include <bits/stdc++.h>
using namespace std;

class Vector2D {
    vector<vector<int>> vec;
    size_t row = 0, col = 0;

    // Move onto a real element, or to row == vec.size() if none is left.
    void settle() {
        while (row < vec.size() && col == vec[row].size()) {
            ++row;
            col = 0;
        }
    }

public:
    explicit Vector2D(vector<vector<int>>& v) : vec(std::move(v)) {}

    int next() {
        settle();
        return vec[row][col++];
    }

    bool hasNext() {
        settle();
        return row < vec.size();
    }
};

int main() {
    vector<vector<int>> v{{1, 2}, {}, {3}, {}, {}};
    Vector2D it(v);
    while (it.hasNext()) cout << it.next() << ' ';
    cout << '\n';  // 1 2 3
    return 0;
}
