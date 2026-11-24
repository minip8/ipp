import java.util.*;

class Twitter {
    private int clock = 0;
    private final Map<Integer, List<int[]>> tweets = new HashMap<>(); // user -> {time, tweetId}
    private final Map<Integer, Set<Integer>> follows = new HashMap<>();

    public Twitter() {}

    public void postTweet(int userId, int tweetId) {
        tweets.computeIfAbsent(userId, k -> new ArrayList<>()).add(new int[] { ++clock, tweetId });
    }

    public List<Integer> getNewsFeed(int userId) {
        // entries: {time, user, index}
        PriorityQueue<int[]> heap = new PriorityQueue<>((a, b) -> Integer.compare(b[0], a[0]));
        Set<Integer> users = new HashSet<>(follows.getOrDefault(userId, Set.of()));
        users.add(userId);
        for (int u : users) {
            List<int[]> ts = tweets.get(u);
            if (ts != null && !ts.isEmpty()) heap.add(new int[] { ts.get(ts.size() - 1)[0], u, ts.size() - 1 });
        }
        List<Integer> feed = new ArrayList<>();
        while (!heap.isEmpty() && feed.size() < 10) {
            int[] top = heap.poll();
            List<int[]> ts = tweets.get(top[1]);
            feed.add(ts.get(top[2])[1]);
            if (top[2] > 0) heap.add(new int[] { ts.get(top[2] - 1)[0], top[1], top[2] - 1 });
        }
        return feed;
    }

    public void follow(int followerId, int followeeId) {
        if (followerId != followeeId) follows.computeIfAbsent(followerId, k -> new HashSet<>()).add(followeeId);
    }

    public void unfollow(int followerId, int followeeId) {
        Set<Integer> s = follows.get(followerId);
        if (s != null) s.remove(followeeId);
    }
}

public class Main {
    public static void main(String[] args) {
        Twitter t = new Twitter();
        t.postTweet(1, 501);
        t.follow(1, 2);
        t.postTweet(2, 77);
        t.postTweet(1, 900);
        System.out.println(t.getNewsFeed(1) + " " + t.getNewsFeed(2));
        t.unfollow(1, 2);
        System.out.println(t.getNewsFeed(1));
    }
}
