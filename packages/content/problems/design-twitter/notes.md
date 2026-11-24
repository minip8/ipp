**Approaches**
- Global list of all tweets; feed scans it backwards, keeping tweets by the user or their followees until 10 are found. O(total tweets) per feed in the worst case (e.g. a user who follows nobody active). Simple; fine as a first answer.
- Expected — pull model with a k-way merge: per user a list of (timestamp, tweetId) in posting order, and a set of followees. For a feed, take the last tweet of each relevant user into a max-heap keyed by timestamp, pop the most recent, push that user's previous tweet, stop after 10. O(F + 10 log F) where F = number of followees (+1). Only the last 10 tweets per user are ever needed, so per-user storage can be capped.
- Simpler variant that is also fine at this scale: gather the last 10 tweets of each relevant user and sort/partial-sort them: O(10F log(10F)).
- Use a global counter as the timestamp; do not order by tweetId.

**Common wrong turns**
- Ordering by `tweetId` instead of posting time (tests use non-monotonic ids).
- Self-follow / self-unfollow: unfollowing oneself must not hide one's own tweets; following oneself must not duplicate them in the feed.
- Duplicate entries when a user is followed twice (use a set).
- Returning oldest-first, or more than 10.
- Snapshotting followees' tweets at follow time (push model) and forgetting to remove them on unfollow.

**Hint ladder**
1. Which tweets can possibly appear in a user's feed?
2. Each relevant user's own tweets are already in time order. What classic problem is "the 10 most recent across several sorted lists"?
3. Merge k sorted lists with a heap, but stop after 10 items.
4. Use a global increasing counter as the timestamp, and keep followees in a set.

**Follow-ups**
- Fan-out on write (push each tweet into followers' feeds) vs fan-out on read (this solution). What happens for a celebrity with 10^8 followers? (hybrid approaches)
- Pagination: "the next 10 after this cursor".
- Storage and caching at scale; eventual consistency of the follow graph.
- Ranking beyond recency.
