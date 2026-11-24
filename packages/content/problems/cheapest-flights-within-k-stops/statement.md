There are `n` cities labelled `0` to `n - 1`. Each entry `flights[i] = [from, to, price]` is a one-way flight costing `price`.

Return the cheapest total price to travel from `src` to `dst` using **at most `k` intermediate stops** (so at most `k + 1` flights). A stop is any city you land in other than `dst`. Return `-1` if no such route exists.

**Examples**

```
n = 4, flights = [[0,1,100],[1,2,100],[2,0,100],[1,3,600],[2,3,200]], src = 0, dst = 3, k = 1   ->  700
```

`0 -> 1 -> 3` costs 700 with one stop. `0 -> 1 -> 2 -> 3` costs only 400 but needs two stops.

```
n = 3, flights = [[0,1,100],[1,2,100],[0,2,500]], src = 0, dst = 2, k = 1   ->  200
n = 3, flights = [[0,1,100],[1,2,100],[0,2,500]], src = 0, dst = 2, k = 0   ->  500
```

**Constraints**

- `2 <= n <= 1000`
- `0 <= flights.length <= 10^4`
- `from != to`, `1 <= price <= 10^4`; there is at most one flight per ordered pair `(from, to)`
- `0 <= src, dst < n`, `src != dst`
- `0 <= k < n`
