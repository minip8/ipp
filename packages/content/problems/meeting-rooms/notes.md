**Approaches**
- Brute force: check every pair for overlap (`a.start < b.end && b.start < a.end`). O(n^2).
- Expected: sort by start time, then check each meeting starts no earlier than the previous one ends. O(n log n) time, O(1)–O(n) extra depending on the sort.
- Alternative: sort starts and ends separately and sweep (sets up Meeting Rooms II).

**Common wrong turns**
- Treating touching intervals (`end == next start`) as overlapping — use `<` not `<=`.
- Sorting by end and comparing the wrong pair, or comparing only with the first meeting.
- Not handling the empty list.
- Sorting the caller's input in place — fine here, but worth asking whether that's acceptable.

**Hint ladder**
1. If the meetings were in chronological order, which pairs would you need to compare?
2. After sorting by start time, can a meeting overlap one that isn't its immediate predecessor without also overlapping the predecessor? Why not?
3. Sort by start; compare each start with the previous end.

**Follow-ups**
- Minimum number of rooms needed (Meeting Rooms II: sweep line or min-heap of end times).
- Return the first conflicting pair.
- Meetings arrive online and you must reject conflicting bookings (balanced BST / `std::map` lookup of neighbours).
