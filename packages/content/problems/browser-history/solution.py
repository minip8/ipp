class BrowserHistory:
    """One array; entries after `last` are stale and ignored."""

    def __init__(self, homepage: str) -> None:
        self.pages = [homepage]
        self.cur = 0
        self.last = 0

    def visit(self, url: str) -> None:
        self.cur += 1
        if self.cur == len(self.pages):
            self.pages.append(url)
        else:
            self.pages[self.cur] = url
        self.last = self.cur

    def back(self, steps: int) -> str:
        self.cur = max(0, self.cur - steps)
        return self.pages[self.cur]

    def forward(self, steps: int) -> str:
        self.cur = min(self.last, self.cur + steps)
        return self.pages[self.cur]


if __name__ == "__main__":
    b = BrowserHistory("home.io")
    for u in ("a.io", "b.io", "c.io"):
        b.visit(u)
    print(b.back(1), b.back(1), b.forward(1))  # b.io a.io b.io
    b.visit("d.io")
    print(b.forward(2), b.back(2), b.back(7))  # d.io a.io home.io
