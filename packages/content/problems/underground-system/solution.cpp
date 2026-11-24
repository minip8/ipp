#include <bits/stdc++.h>
using namespace std;

class UndergroundSystem {
    struct PairHash {
        size_t operator()(const pair<string, string>& p) const {
            size_t h = hash<string>{}(p.first);
            return h ^ (hash<string>{}(p.second) + 0x9e3779b97f4a7c15ULL + (h << 6) + (h >> 2));
        }
    };
    unordered_map<int, pair<string, int>> active;  // card -> (start station, time)
    unordered_map<pair<string, string>, pair<long long, int>, PairHash> stats;  // route -> (total, count)

public:
    UndergroundSystem() = default;

    void checkIn(int id, string stationName, int t) { active[id] = {std::move(stationName), t}; }

    void checkOut(int id, string stationName, int t) {
        auto it = active.find(id);
        auto& s = stats[{it->second.first, std::move(stationName)}];
        s.first += t - it->second.second;
        s.second += 1;
        active.erase(it);
    }

    double getAverageTime(string startStation, string endStation) {
        const auto& s = stats.at({startStation, endStation});
        return (double)s.first / s.second;
    }
};

int main() {
    UndergroundSystem u;
    u.checkIn(1, "Bank", 3);
    u.checkIn(2, "Bank", 4);
    u.checkOut(1, "Oval", 15);
    u.checkOut(2, "Oval", 21);
    cout << u.getAverageTime("Bank", "Oval") << '\n';  // 14.5
    return 0;
}
