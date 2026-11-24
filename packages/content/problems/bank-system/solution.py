class Bank:
    def __init__(self, balance: list[int]) -> None:
        self.bal = list(balance)

    def _valid(self, account: int) -> bool:
        return 1 <= account <= len(self.bal)

    def transfer(self, fromAccount: int, toAccount: int, amount: int) -> bool:
        if not (self._valid(fromAccount) and self._valid(toAccount)) or self.bal[fromAccount - 1] < amount:
            return False
        self.bal[fromAccount - 1] -= amount
        self.bal[toAccount - 1] += amount
        return True

    def deposit(self, account: int, amount: int) -> bool:
        if not self._valid(account):
            return False
        self.bal[account - 1] += amount
        return True

    def withdraw(self, account: int, amount: int) -> bool:
        if not self._valid(account) or self.bal[account - 1] < amount:
            return False
        self.bal[account - 1] -= amount
        return True

    def getBalance(self, account: int) -> int:
        return self.bal[account - 1] if self._valid(account) else -1


if __name__ == "__main__":
    b = Bank([10, 100, 20])
    print(b.withdraw(3, 10), b.transfer(5, 1, 20), b.transfer(2, 1, 100))  # True False True
    print(b.deposit(2, 5), b.transfer(2, 3, 6), b.getBalance(1), b.getBalance(0))  # True False 110 -1
