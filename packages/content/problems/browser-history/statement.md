Model the back/forward buttons of a single browser tab.

- `BrowserHistory(homepage)` opens the tab on `homepage`. The history contains just that page.
- `visit(url)` navigates from the current page to `url`. Every page that was *forward* of the current page is discarded; `url` becomes the newest entry and the current page. Visiting the same URL as the current page still adds a new entry.
- `back(steps)` moves back up to `steps` pages (stopping at the oldest entry) and returns the URL of the page you end up on.
- `forward(steps)` moves forward up to `steps` pages (stopping at the newest entry) and returns the URL of the page you end up on.

**Example**

```
BrowserHistory b("home.io")
b.visit("a.io")
b.visit("b.io")
b.visit("c.io")
b.back(1)        -> "b.io"
b.back(1)        -> "a.io"
b.forward(1)     -> "b.io"
b.visit("d.io")             c.io is discarded
b.forward(2)     -> "d.io"  nothing ahead
b.back(2)        -> "a.io"
b.back(7)        -> "home.io"   cannot go past the first page
```

**Constraints**

- `1 <= homepage.length, url.length <= 20`, lowercase letters and `.`
- `1 <= steps <= 100`
- At most `5000` calls per test.
