#include <bits/stdc++.h>
using namespace std;

class Bank {
    vector<long long> bal;

    bool valid(int account) const { return account >= 1 && account <= (int)bal.size(); }

public:
    explicit Bank(vector<long long>& balance) : bal(balance) {}

    bool transfer(int fromAccount, int toAccount, long long amount) {
        if (!valid(fromAccount) || !valid(toAccount) || bal[fromAccount - 1] < amount) return false;
        bal[fromAccount - 1] -= amount;
        bal[toAccount - 1] += amount;
        return true;
    }

    bool deposit(int account, long long amount) {
        if (!valid(account)) return false;
        bal[account - 1] += amount;
        return true;
    }

    bool withdraw(int account, long long amount) {
        if (!valid(account) || bal[account - 1] < amount) return false;
        bal[account - 1] -= amount;
        return true;
    }

    long long getBalance(int account) { return valid(account) ? bal[account - 1] : -1; }
};

int main() {
    vector<long long> init{10, 100, 20};
    Bank b(init);
    cout << boolalpha << b.withdraw(3, 10) << ' ' << b.transfer(5, 1, 20) << ' ' << b.transfer(2, 1, 100) << '\n';
    cout << b.deposit(2, 5) << ' ' << b.transfer(2, 3, 6) << ' ' << b.getBalance(1) << ' ' << b.getBalance(0) << '\n';
    return 0;
}
