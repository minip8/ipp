**Approaches**
- Expected (sliding window log): hash map from client to a queue of accepted timestamps. On a request, pop from the front while `front <= timestamp - windowSeconds`; accept iff the queue size is `< maxRequests`, then push. Amortised O(1) per call, memory O(clients * maxRequests).
- Equivalent: since at most `maxRequests` entries are ever kept, a per-client ring buffer of size `maxRequests` works: accept iff the slot holding the oldest of the last `maxRequests` accepted times is outside the window (or not yet filled). O(1) worst case, fixed memory per client — nice for C++.
- Fixed-window counters (reset every `windowSeconds`) are cheaper but give **different answers** (allow 2x bursts at window edges); they fail the tests. Discuss as a trade-off.
- Token bucket / leaky bucket: also different semantics (smooth refill). Good follow-up discussion; not what is asked here.

**Common wrong turns**
- Recording rejected requests (the example's last line catches it; test `h-rejected-not-counted`).
- Boundary: keeping a request exactly `windowSeconds` old (`<` vs `<=` in the eviction loop).
- One global queue instead of per-client queues.
- Fixed-window implementation.
- Never cleaning up idle clients — memory leak in a real service (discuss; tests do not detect it).

**Hint ladder**
1. For one client, what information decides whether the next request is allowed?
2. Which past requests can still matter, and in which order do they stop mattering?
3. Keep a queue of accepted times per client; drop expired ones from the front before deciding.
4. Accept iff fewer than `maxRequests` remain, and only then push the new time.

**Follow-ups**
- Memory per client is O(maxRequests). Sliding window *counter* approximation (two fixed windows, weighted) uses O(1) — what accuracy do you lose?
- Token bucket: implement with a lazily refilled token count and last-refill time; floating-point vs integer arithmetic.
- Distributed rate limiting across many API servers (Redis with Lua/sorted sets, approximate local limits, sticky routing).
- Concurrency: two requests from the same client on different threads.
- Evicting state for idle clients (TTL, LRU on client ids).
