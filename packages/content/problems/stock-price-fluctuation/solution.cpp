#include <bits/stdc++.h>
using namespace std;

class StockPrice {
    unordered_map<int, int> priceAt;  // timestamp -> current price
    multiset<int> prices;             // one entry per timestamp
    int latest = 0;

public:
    StockPrice() = default;

    void update(int timestamp, int price) {
        auto it = priceAt.find(timestamp);
        if (it != priceAt.end()) {
            prices.erase(prices.find(it->second));  // erase exactly one copy
            it->second = price;
        } else {
            priceAt.emplace(timestamp, price);
        }
        prices.insert(price);
        latest = max(latest, timestamp);
    }

    int current() { return priceAt[latest]; }

    int maximum() { return *prices.rbegin(); }

    int minimum() { return *prices.begin(); }
};

int main() {
    StockPrice s;
    s.update(1, 10);
    s.update(2, 5);
    cout << s.current() << ' ' << s.maximum() << '\n';  // 5 10
    s.update(1, 3);
    cout << s.maximum() << '\n';  // 5
    return 0;
}
