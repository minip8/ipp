**Approaches**
- Observation: the answer is the maximum number of meetings in progress at any instant.
- Brute force: for every start time, count meetings covering it. O(n^2).
- Expected (A): sort by start; keep a min-heap of end times of rooms in use. For each meeting, if the earliest-ending room is free (`heap top <= start`) pop it; push this meeting's end. Answer = max heap size (or final size). O(n log n).
- Expected (B): sweep line / two sorted arrays. Sort starts and ends separately; walk the starts, and for each start release every end `<= start`. Count the max in use. O(n log n), simpler constant.
- Event list `(time, +1/-1)` sorted with ends before starts at equal times — equivalent to (B).

**Common wrong turns**
- Ties: an end at time t must be processed before a start at time t (otherwise back-to-back meetings use an extra room).
- Comparing only with the previous meeting (that's Meeting Rooms I logic).
- Heap without sorting by start first.
- Counting all overlaps pairwise (overlap count isn't the room count).

**Hint ladder**
1. At any single moment, how many rooms are needed? Which moment matters?
2. Where can the number of ongoing meetings change? Can you visit those moments in order?
3. Sort the starts and the ends; sweep through time, opening a room on a start and freeing one on an end — and decide carefully which comes first when they're equal.

**Follow-ups**
- Return an assignment of meetings to rooms (heap of (end, roomId)).
- Meeting Rooms III: fixed number of rooms, delayed meetings — which room hosts the most?
- Streaming meetings with cancellations (balanced tree / difference array over compressed times).
