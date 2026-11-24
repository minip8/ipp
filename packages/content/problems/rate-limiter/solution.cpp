#include <bits/stdc++.h>
using namespace std;

// Per client, a ring buffer of the last `maxRequests` accepted times. A request is accepted iff
// fewer than maxRequests have been accepted, or the oldest of the last maxRequests is out of window.
class RateLimiter {
    struct Log {
        vector<int> times;  // grows up to maxRequests, then used as a ring
        size_t oldest = 0;  // index of the oldest entry once full
    };
    int maxRequests, window;
    unordered_map<int, Log> logs;

public:
    RateLimiter(int maxRequests, int windowSeconds) : maxRequests(maxRequests), window(windowSeconds) {}

    bool allow(int clientId, int timestamp) {
        Log& log = logs[clientId];
        if ((int)log.times.size() < maxRequests) {
            log.times.push_back(timestamp);
            return true;
        }
        if (log.times[log.oldest] > timestamp - window) return false;  // still inside the window
        log.times[log.oldest] = timestamp;
        log.oldest = (log.oldest + 1) % log.times.size();
        return true;
    }
};

int main() {
    RateLimiter r(2, 10);
    pair<int, int> calls[] = {{1, 1}, {1, 5}, {1, 8}, {2, 8}, {1, 11}, {1, 14}, {1, 15}};
    for (auto [c, t] : calls) cout << (r.allow(c, t) ? "true " : "false ");
    cout << '\n';  // true true false true true false true
    return 0;
}
