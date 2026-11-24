import java.util.*;

class Bank {
    private final long[] bal;

    public Bank(long[] balance) {
        bal = balance.clone();
    }

    private boolean valid(int a) {
        return a >= 1 && a <= bal.length;
    }

    public boolean transfer(int fromAccount, int toAccount, long amount) {
        if (!valid(fromAccount) || !valid(toAccount) || bal[fromAccount - 1] < amount) return false;
        bal[fromAccount - 1] -= amount;
        bal[toAccount - 1] += amount;
        return true;
    }

    public boolean deposit(int account, long amount) {
        if (!valid(account)) return false;
        bal[account - 1] += amount;
        return true;
    }

    public boolean withdraw(int account, long amount) {
        if (!valid(account) || bal[account - 1] < amount) return false;
        bal[account - 1] -= amount;
        return true;
    }

    public long getBalance(int account) {
        return valid(account) ? bal[account - 1] : -1;
    }
}

public class Main {
    public static void main(String[] args) {
        Bank b = new Bank(new long[] { 10, 100, 20 });
        System.out.println(b.withdraw(3, 10) + " " + b.transfer(5, 1, 20) + " " + b.transfer(2, 1, 100));
        System.out.println(b.deposit(2, 5) + " " + b.transfer(2, 3, 6) + " " + b.getBalance(1) + " " + b.getBalance(0));
    }
}
