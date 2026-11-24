**Approaches**
- Brute force: store every completed journey; average by scanning. O(journeys) per query.
- Expected: two hash maps. `active: id -> (station, time)` for open journeys; `stats: (start, end) -> (totalTime, count)`. checkIn/checkOut are O(1) (plus string hashing), `getAverageTime` is O(1). Memory O(passengers in transit + station pairs).

**Common wrong turns**
- Keying the route as `start + end` concatenated without a separator: ("ab","c") and ("a","bc") collide. Test `h-key-collision` targets it. Use a pair/tuple key or a separator that cannot appear in names.
- Integer division when averaging (`total / count` in C++/Java with ints).
- Treating A->B and B->A as the same route.
- Not erasing the check-in record on check-out (memory leak; a later trip by the same card still works if overwritten, so tests may not catch it — ask).
- Storing every journey duration in a list per route (works but O(n) memory where O(1) suffices; then summing per query is O(n)).
- Totals can reach 2*10^4 * 10^6 = 2*10^10: overflows 32-bit `int` — use 64-bit or double for the sum.

**Hint ladder**
1. What do you need to remember about a passenger between their check-in and check-out?
2. To answer an average, do you need every journey, or just a couple of numbers per route?
3. Keep a running total and count for each (start, end) pair.
4. Two maps: open journeys by card id, and route statistics keyed by the ordered pair of station names.

**Follow-ups**
- Median or p95 journey time instead of mean (need the distribution: per-route sorted structure or a histogram/t-digest).
- Average over only the last N days (time-bucketed totals).
- Validation: duplicate check-ins, check-out without check-in, clock skew — how should the API report errors?
- Station names as strings are slow to hash on the hot path: intern them to integer ids.
