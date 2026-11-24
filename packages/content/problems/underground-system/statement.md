A metro network records when passengers tap in and out with their travel cards. Build the service that reports the average journey time between two stations.

- `UndergroundSystem()` creates the service with no data.
- `checkIn(id, stationName, t)` — the card `id` taps in at `stationName` at time `t`.
- `checkOut(id, stationName, t)` — the card `id` taps out at `stationName` at time `t`. This completes one journey from the station where that card last checked in to `stationName`, taking `t - checkInTime`.
- `getAverageTime(startStation, endStation)` returns the mean duration of all **completed** journeys that started at `startStation` and ended at `endStation`, as a floating-point number. Direction matters: journeys from B to A do not count towards A to B.

Guarantees (you do not need to check them):

- A card is checked in at most once at a time: every `checkOut(id, ...)` matches the most recent `checkIn(id, ...)`, and a card checks in again only after checking out. The same card can make many journeys.
- Every check-out time is strictly greater than its check-in time.
- `getAverageTime` is only called for a pair of stations with at least one completed journey.
- A journey may start and end at the same station.

Answers are accepted within `1e-6` absolute or relative error.

**Example**

```
UndergroundSystem u
u.checkIn(1, "Bank", 3)
u.checkIn(2, "Bank", 4)
u.checkOut(1, "Oval", 15)                          journey Bank -> Oval, 12
u.getAverageTime("Bank", "Oval")      -> 12.0
u.checkOut(2, "Oval", 21)                          journey Bank -> Oval, 17
u.getAverageTime("Bank", "Oval")      -> 14.5
u.checkIn(1, "Oval", 30)
u.checkOut(1, "Bank", 31)                          Oval -> Bank, a different direction
u.getAverageTime("Bank", "Oval")      -> 14.5
u.getAverageTime("Oval", "Bank")      -> 1.0
```

**Constraints**

- `1 <= id, t <= 10^6`
- `1 <= stationName.length <= 10`, letters and digits
- At most `2 * 10^4` calls per test.
