Build the core of a tiny social network: users post short messages ("tweets"), follow each other, and read a news feed.

Users are identified by integers and exist implicitly — any user id may appear in any call, even if it was never seen before. Every tweet has a unique id. Tweets are ordered by **when `postTweet` was called**: a later call is more recent, regardless of the tweet ids' numeric values.

- `Twitter()` creates an empty network.
- `postTweet(userId, tweetId)` records that `userId` posted tweet `tweetId`. Each `tweetId` is posted at most once.
- `getNewsFeed(userId) -> list<int>` returns the ids of the **10 most recent** tweets posted by `userId` themselves or by any user `userId` currently follows, **most recent first**. If fewer than 10 such tweets exist, return all of them. Following is evaluated at the time of this call: tweets by someone the user has unfollowed are not included, and tweets posted by a followee *before* the follow began are included.
- `follow(followerId, followeeId)` makes `followerId` follow `followeeId`. Does nothing if already following or if both ids are the same.
- `unfollow(followerId, followeeId)` stops `followerId` following `followeeId`. Does nothing if not following or if both ids are the same (a user always sees their own tweets).

**Example**

```
Twitter t
t.postTweet(1, 501)
t.getNewsFeed(1)       -> [501]
t.follow(1, 2)
t.postTweet(2, 77)
t.postTweet(1, 900)
t.getNewsFeed(1)       -> [900, 77, 501]    most recent first, by posting order
t.getNewsFeed(2)       -> [77]              following is one-directional
t.unfollow(1, 2)
t.getNewsFeed(1)       -> [900, 501]
```

**Constraints**

- `1 <= userId, followerId, followeeId <= 1000`
- `0 <= tweetId <= 10^6`, all distinct.
- At most `3 * 10^4` calls in total per test.
- `getNewsFeed` should not need to look at every tweet ever posted.
