A city has several bus lines. `routes[i]` lists the stops served by bus `i`; the bus loops over its list forever, so once you are on bus `i` you can get off at **any** stop in `routes[i]`.

You are at stop `source` (not on any bus) and want to reach stop `target`. You can board a bus at any stop it serves and switch buses at any stop they both serve.

Return the minimum number of **buses you have to board** to get from `source` to `target`, or `-1` if it is impossible. If `source == target`, the answer is `0`.

**Examples**

```
routes = [[1, 4, 7], [3, 6, 7]], source = 1, target = 6   ->   2
```
Take bus 0 from stop 1 to stop 7, then bus 1 from 7 to 6.

```
routes = [[2, 5], [5, 8, 9], [9, 12], [20, 21]], source = 2, target = 21   ->   -1
```

```
routes = [[10, 11]], source = 4, target = 4   ->   0
```

**Constraints**

- `1 <= routes.length <= 500`
- `1 <= routes[i].length`, and the total number of stops over all routes is at most `10^5`
- Stops within one route are distinct.
- `0 <= routes[i][j], source, target < 10^6`
- `source` and `target` need not appear in any route.
