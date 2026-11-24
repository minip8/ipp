A sign-up system has collected a list of `accounts`. Each account is a list of strings: the first string is the person's **name**, and the rest are **email addresses** registered on that account.

Two accounts belong to the same person if they have at least one email address in common. This is transitive: if account A shares an email with B, and B shares a (possibly different) email with C, then A, B and C all belong to one person. Accounts that are not linked this way belong to different people, **even if the names are the same**. All accounts of one person carry the same name.

Merge the accounts and return one entry per person: the name first, followed by all of that person's distinct email addresses in **sorted (lexicographic, byte-wise) order**. The entries themselves may be returned in any order.

**Example**

```
accounts = [
  ["Ana",  "ana@x.io", "ana.k@mail.com"],
  ["Ben",  "ben@y.org"],
  ["Ana",  "a.k@work.net", "ana@x.io"],
  ["Ana",  "ana2@x.io"]
]
->
[
  ["Ana", "a.k@work.net", "ana.k@mail.com", "ana@x.io"],
  ["Ben", "ben@y.org"],
  ["Ana", "ana2@x.io"]
]
```
The first and third accounts share `ana@x.io` and are merged. The fourth "Ana" shares nothing with them, so it is a different person.

**Constraints**

- `1 <= accounts.length <= 1000`
- `2 <= accounts[i].length <= 10`
- `1 <= accounts[i][j].length <= 30`; names are letters only, emails consist of English letters, digits, `.`, `_` and one `@`
- An email may be repeated within the same account.
