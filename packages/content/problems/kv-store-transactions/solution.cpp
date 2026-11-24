#include <bits/stdc++.h>
using namespace std;

class KVStore {
    unordered_map<string, int> data;
    unordered_map<int, int> counts;
    // One undo log per open transaction: key -> value before the transaction first touched it.
    vector<unordered_map<string, optional<int>>> logs;

    void write(const string& key, optional<int> value) {
        auto it = data.find(key);
        if (it != data.end()) {
            --counts[it->second];
            if (!value) data.erase(it);
        }
        if (value) {
            data[key] = *value;
            ++counts[*value];
        }
    }

    void log(const string& key) {
        if (logs.empty()) return;
        auto& top = logs.back();
        if (top.count(key)) return;
        auto it = data.find(key);
        top.emplace(key, it == data.end() ? nullopt : optional<int>(it->second));
    }

public:
    KVStore() {}

    void set(string key, int value) {
        log(key);
        write(key, value);
    }

    int get(string key) {
        auto it = data.find(key);
        return it == data.end() ? -1 : it->second;
    }

    void unset(string key) {
        if (!data.count(key)) return;
        log(key);
        write(key, nullopt);
    }

    int count(int value) {
        auto it = counts.find(value);
        return it == counts.end() ? 0 : it->second;
    }

    void begin() { logs.emplace_back(); }

    bool rollback() {
        if (logs.empty()) return false;
        auto top = std::move(logs.back());
        logs.pop_back();
        for (auto& [key, old] : top) write(key, old);
        return true;
    }

    bool commit() {
        if (logs.empty()) return false;
        auto top = std::move(logs.back());
        logs.pop_back();
        if (!logs.empty())
            for (auto& [key, old] : top) logs.back().emplace(key, old);  // emplace keeps older entries
        return true;
    }
};

int main() {
    KVStore db;
    db.set("a", 10);
    db.begin();
    db.set("a", 20);
    db.set("b", 20);
    cout << db.count(20) << '\n';  // 2
    db.begin();
    db.unset("a");
    cout << db.get("a") << ' ' << db.rollback() << ' ' << db.get("a") << '\n';  // -1 1 20
    cout << db.commit() << ' ' << db.rollback() << ' ' << db.get("a") << ' ' << db.count(10) << '\n';  // 1 0 20 0
    return 0;
}
