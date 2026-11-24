#include <bits/stdc++.h>
using namespace std;

class TimeMap {
    struct Versions {
        vector<int> times;  // strictly increasing
        vector<string> values;
    };
    unordered_map<string, Versions> store;

public:
    TimeMap() = default;

    void set(string key, string value, int timestamp) {
        Versions& v = store[key];
        v.times.push_back(timestamp);
        v.values.push_back(std::move(value));
    }

    string get(string key, int timestamp) {
        auto it = store.find(key);
        if (it == store.end()) return "";
        const auto& ts = it->second.times;
        auto pos = upper_bound(ts.begin(), ts.end(), timestamp) - ts.begin();
        return pos == 0 ? "" : it->second.values[pos - 1];
    }
};

int main() {
    TimeMap m;
    m.set("price", "100", 5);
    m.set("price", "105", 9);
    for (int t : {4, 5, 8, 9, 50}) cout << '"' << m.get("price", t) << "\" ";
    cout << '"' << m.get("volume", 9) << "\"\n";
    return 0;
}
