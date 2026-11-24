import heapq
from collections import defaultdict


class Twitter:
    """Per-user tweet lists in posting order + followee sets; feeds via a k-way heap merge."""

    def __init__(self) -> None:
        self.clock = 0
        self.tweets: defaultdict[int, list[tuple[int, int]]] = defaultdict(list)  # user -> [(time, id)]
        self.follows: defaultdict[int, set[int]] = defaultdict(set)

    def postTweet(self, userId: int, tweetId: int) -> None:
        self.clock += 1
        self.tweets[userId].append((self.clock, tweetId))

    def getNewsFeed(self, userId: int) -> list[int]:
        heap = []
        for u in self.follows[userId] | {userId}:
            ts = self.tweets.get(u)
            if ts:
                i = len(ts) - 1
                heap.append((-ts[i][0], ts[i][1], u, i))
        heapq.heapify(heap)
        feed = []
        while heap and len(feed) < 10:
            _, tid, u, i = heapq.heappop(heap)
            feed.append(tid)
            if i > 0:
                t, nid = self.tweets[u][i - 1]
                heapq.heappush(heap, (-t, nid, u, i - 1))
        return feed

    def follow(self, followerId: int, followeeId: int) -> None:
        if followerId != followeeId:
            self.follows[followerId].add(followeeId)

    def unfollow(self, followerId: int, followeeId: int) -> None:
        self.follows[followerId].discard(followeeId)


if __name__ == "__main__":
    t = Twitter()
    t.postTweet(1, 501)
    t.follow(1, 2)
    t.postTweet(2, 77)
    t.postTweet(1, 900)
    print(t.getNewsFeed(1), t.getNewsFeed(2))  # [900, 77, 501] [77]
    t.unfollow(1, 2)
    print(t.getNewsFeed(1))  # [900, 501]
