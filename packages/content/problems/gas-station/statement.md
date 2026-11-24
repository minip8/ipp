`n` gas stations sit on a circular road. At station `i` you can fill up `gas[i]` units of fuel, and driving from station `i` to station `(i + 1) % n` burns `cost[i]` units.

Your car has an unlimited tank and starts **empty** at a station of your choice. Return the index of a starting station from which you can drive all the way around the circle once, clockwise, returning to the start — or `-1` if no such station exists.

Your fuel may hit exactly `0` on arrival at a station; it may never go negative. The input is constructed so that **at most one** starting station works, so the answer is unique.

**Examples**

```
gas = [1, 2, 3, 4, 5], cost = [3, 4, 5, 1, 2]   ->   3
    start at 3: 4-1=3, +5-2=6, +1-3=4, +2-4=2, +3-5=0  ✓
gas = [2, 3, 4], cost = [3, 4, 3]               ->   -1    total gas 9 < total cost 10
gas = [5], cost = [5]                           ->   0
```

**Constraints**

- `1 <= n <= 10^5`, `gas.length == cost.length == n`
- `0 <= gas[i], cost[i] <= 10^4`
- At most one valid starting station exists.
