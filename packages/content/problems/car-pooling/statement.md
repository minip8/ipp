A car with `capacity` empty seats drives east along a road, never turning back. `trips[i] = [passengers_i, from_i, to_i]` means a group of `passengers_i` people must be picked up at kilometre `from_i` and dropped off at kilometre `to_i`.

Passengers being dropped off at kilometre `x` leave **before** new passengers board at `x`. Return `true` if every group can be carried without ever exceeding `capacity`, `false` otherwise.

**Examples**

```
trips = [[2, 1, 5], [3, 3, 7]], capacity = 4     ->   false    5 people between km 3 and 5
trips = [[2, 1, 5], [3, 3, 7]], capacity = 5     ->   true
trips = [[3, 2, 6], [4, 6, 9]], capacity = 4     ->   true     the first group leaves at 6 as the second boards
```

**Constraints**

- `1 <= trips.length <= 10^4`
- `1 <= passengers_i <= 100`
- `0 <= from_i < to_i <= 10^6`
- `1 <= capacity <= 10^6`
