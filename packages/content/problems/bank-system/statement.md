A bank has `n` accounts numbered **1 to n**. The constructor receives their opening balances: `balance[i]` is the balance of account `i + 1`. Implement the bank's operations. Each operation either succeeds completely or fails and changes nothing.

- `Bank(balance)` sets up the accounts.
- `transfer(fromAccount, toAccount, amount) -> bool` moves `amount` from `fromAccount` to `toAccount`. It fails if either account number is not in `1..n`, or if `fromAccount`'s balance is less than `amount`. A transfer from an account to itself succeeds under the same conditions and leaves the balance unchanged.
- `deposit(account, amount) -> bool` adds `amount` to `account`. It fails if the account number is not in `1..n`.
- `withdraw(account, amount) -> bool` removes `amount` from `account`. It fails if the account number is not in `1..n` or its balance is less than `amount`.
- `getBalance(account) -> long` returns the account's current balance, or `-1` if the account number is not in `1..n`.

Each method returning `bool` returns `true` on success and `false` on failure. Withdrawing or transferring an account's entire balance is allowed (it ends at 0).

**Example**

```
Bank b([10, 100, 20])
b.withdraw(3, 10)        -> true    account 3: 20 -> 10
b.transfer(5, 1, 20)     -> false   account 5 does not exist
b.transfer(2, 1, 100)    -> true    account 2: 0, account 1: 110
b.deposit(2, 5)          -> true    account 2: 5
b.transfer(2, 3, 6)      -> false   account 2 only has 5
b.getBalance(1)          -> 110
b.getBalance(0)          -> -1      accounts start at 1
```

**Constraints**

- `1 <= n <= 10^5`
- `0 <= balance[i] <= 10^12` — balances do not fit in a 32-bit integer
- `0 <= amount <= 10^9`
- Account numbers passed to methods may be any value in `[-10^9, 10^9]`.
- At most `10^4` calls in total per test.
