An API allows each client at most `maxRequests` requests in any window of `windowSeconds` seconds. Implement the check that runs on every incoming request.

- `RateLimiter(maxRequests, windowSeconds)` creates a limiter with no history.
- `allow(clientId, timestamp)` is called when client `clientId` sends a request at time `timestamp` (in seconds). Let `A` be the number of **previously accepted** requests from the same client whose time `s` satisfies `timestamp - windowSeconds < s <= timestamp`. If `A < maxRequests`, the request is accepted: record it and return `true`. Otherwise return `false`.

Details:

- Rejected requests are **not** recorded and never count against the client.
- Clients are independent; each has its own history.
- A request exactly `windowSeconds` seconds older than the current one is outside the window.
- Timestamps across all calls are non-decreasing. Several requests may share a timestamp.

**Example**

```
RateLimiter r(2, 10)          at most 2 requests per 10 seconds
r.allow(1, 1)    -> true
r.allow(1, 5)    -> true
r.allow(1, 8)    -> false     requests at 1 and 5 are in (-2, 8]
r.allow(2, 8)    -> true      client 2 has its own budget
r.allow(1, 11)   -> true      window (1, 11] holds only the request at 5
r.allow(1, 14)   -> false     window (4, 14] holds 5 and 11
r.allow(1, 15)   -> true      window (5, 15] holds only 11 — the rejected call at 14 never counted
```

**Constraints**

- `1 <= maxRequests <= 1000`
- `1 <= windowSeconds <= 10^6`
- `0 <= clientId <= 10^9`
- `0 <= timestamp <= 10^9`
- At most `10^5` calls per test.
