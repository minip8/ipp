#include <bits/stdc++.h>
using namespace std;

class OrderBook {
    struct Order {
        int id, qty;
    };
    struct Level {
        long long volume = 0;
        list<Order> queue;  // front = oldest
    };
    struct Loc {
        bool buy;
        int price;
        list<Order>::iterator it;
    };

    map<int, Level, greater<int>> bids;  // best (highest) first
    map<int, Level> asks;                // best (lowest) first
    unordered_map<int, Loc> resting;
    unordered_set<int> used;
    vector<vector<int>> fills;

    template <class Book>
    int match(Book& book, bool incomingBuy, int price, int qty) {
        int remaining = qty;
        while (remaining > 0 && !book.empty()) {
            auto lvl = book.begin();
            if (incomingBuy ? lvl->first > price : lvl->first < price) break;
            auto& q = lvl->second.queue;
            while (remaining > 0 && !q.empty()) {
                Order& o = q.front();
                int take = min(remaining, o.qty);
                remaining -= take;
                o.qty -= take;
                lvl->second.volume -= take;
                fills.push_back({o.id, lvl->first, take});
                if (o.qty == 0) {
                    resting.erase(o.id);
                    q.pop_front();
                }
            }
            if (q.empty()) book.erase(lvl);
        }
        return qty - remaining;
    }

    void rest(int id, bool buy, int price, int qty) {
        Level& lvl = buy ? bids[price] : asks[price];
        lvl.queue.push_back({id, qty});
        lvl.volume += qty;
        resting[id] = {buy, price, prev(lvl.queue.end())};
    }

    void removeResting(unordered_map<int, Loc>::iterator r) {
        auto [buy, price, it] = r->second;
        if (buy) {
            auto lvl = bids.find(price);
            lvl->second.volume -= it->qty;
            lvl->second.queue.erase(it);
            if (lvl->second.queue.empty()) bids.erase(lvl);
        } else {
            auto lvl = asks.find(price);
            lvl->second.volume -= it->qty;
            lvl->second.queue.erase(it);
            if (lvl->second.queue.empty()) asks.erase(lvl);
        }
        resting.erase(r);
    }

public:
    OrderBook() {}

    int addOrder(int id, string side, int price, int qty) {
        fills.clear();
        if (price <= 0 || qty <= 0 || used.count(id)) return -1;
        used.insert(id);
        bool buy = side == "buy";
        int filled = buy ? match(asks, true, price, qty) : match(bids, false, price, qty);
        if (filled < qty) rest(id, buy, price, qty - filled);
        return filled;
    }

    bool cancel(int id) {
        auto r = resting.find(id);
        if (r == resting.end()) return false;
        removeResting(r);
        return true;
    }

    bool modify(int id, int newQty) {
        auto r = resting.find(id);
        if (r == resting.end() || newQty <= 0) return false;
        auto& loc = r->second;
        int cur = loc.it->qty;
        if (newQty <= cur) {  // keep queue position
            loc.it->qty = newQty;
            (loc.buy ? bids[loc.price] : asks[loc.price]).volume -= cur - newQty;
        } else {  // lose priority: re-queue at the back
            bool buy = loc.buy;
            int price = loc.price;
            removeResting(r);
            rest(id, buy, price, newQty);
        }
        return true;
    }

    int bestBid() { return bids.empty() ? -1 : bids.begin()->first; }
    int bestAsk() { return asks.empty() ? -1 : asks.begin()->first; }

    int volumeAt(string side, int price) {
        if (side == "buy") {
            auto it = bids.find(price);
            return it == bids.end() ? 0 : (int)it->second.volume;
        }
        auto it = asks.find(price);
        return it == asks.end() ? 0 : (int)it->second.volume;
    }

    vector<vector<int>> lastFills() { return fills; }
};

int main() {
    OrderBook b;
    b.addOrder(1, "sell", 101, 5);
    b.addOrder(2, "sell", 100, 3);
    b.addOrder(3, "sell", 101, 4);
    cout << b.addOrder(4, "buy", 101, 10) << '\n';  // 10
    for (auto& f : b.lastFills()) cout << f[0] << ' ' << f[1] << ' ' << f[2] << '\n';
    cout << b.bestAsk() << ' ' << b.bestBid() << '\n';  // 101 -1
    cout << b.addOrder(5, "buy", 99, 7) << ' ' << b.modify(5, 9) << ' ' << b.volumeAt("buy", 99) << '\n';  // 0 1 9
    return 0;
}
