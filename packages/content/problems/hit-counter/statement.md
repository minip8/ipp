Count how many hits a web page received during the last five minutes.

- `HitCounter()` creates a counter with no hits.
- `hit(timestamp)` records one hit at time `timestamp` (in seconds). Several hits may share a timestamp.
- `getHits(timestamp)` returns the number of hits whose time `s` satisfies `timestamp - 300 < s <= timestamp`, that is, the hits in the 300 seconds ending at `timestamp` (a hit exactly 300 seconds earlier is **not** counted).

Timestamps across **all** calls (both methods) are non-decreasing.

**Example**

```
HitCounter c
c.hit(1)
c.hit(2)
c.hit(2)
c.getHits(4)      -> 3
c.hit(300)
c.getHits(300)    -> 4
c.getHits(301)    -> 3     the hit at time 1 is now exactly 300 s old and drops out
c.getHits(302)    -> 1     both hits at time 2 drop out
c.getHits(1000)   -> 0
```

**Constraints**

- `1 <= timestamp <= 2 * 10^9`
- At most `10^5` calls per test.
