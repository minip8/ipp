#include <bits/stdc++.h>
using namespace std;

class Solution {
public:
    vector<int> asteroidCollision(vector<int>& asteroids) {
        vector<int> stack;
        for (int a : asteroids) {
            bool alive = true;
            while (alive && a < 0 && !stack.empty() && stack.back() > 0) {
                if (stack.back() < -a) { stack.pop_back(); continue; }
                if (stack.back() == -a) stack.pop_back();
                alive = false;
            }
            if (alive) stack.push_back(a);
        }
        return stack;
    }
};

int main() {
    Solution s;
    vector<int> v{3, 5, -8, 2};
    for (int x : s.asteroidCollision(v)) cout << x << ' ';
    cout << '\n';
    return 0;
}
