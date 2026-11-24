class Solution:
    def accountsMerge(self, accounts: list[list[str]]) -> list[list[str]]:
        parent = list(range(len(accounts)))

        def find(x: int) -> int:
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x

        owner: dict[str, int] = {}
        for i, acc in enumerate(accounts):
            for email in acc[1:]:
                if email in owner:
                    ra, rb = find(owner[email]), find(i)
                    if ra != rb:
                        parent[rb] = ra
                else:
                    owner[email] = i

        groups: dict[int, list[str]] = {}
        for email, i in owner.items():
            groups.setdefault(find(i), []).append(email)
        return [[accounts[root][0]] + sorted(emails) for root, emails in groups.items()]


if __name__ == "__main__":
    print(Solution().accountsMerge([
        ["Ana", "ana@x.io", "ana.k@mail.com"],
        ["Ben", "ben@y.org"],
        ["Ana", "a.k@work.net", "ana@x.io"],
        ["Ana", "ana2@x.io"],
    ]))
