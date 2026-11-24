#include <bits/stdc++.h>
using namespace std;

class Twitter {
    int clock = 0;
    unordered_map<int, vector<pair<int, int>>> tweets;  // user -> (time, tweetId), oldest first
    unordered_map<int, unordered_set<int>> follows;

public:
    Twitter() {}

    void postTweet(int userId, int tweetId) { tweets[userId].push_back({++clock, tweetId}); }

    vector<int> getNewsFeed(int userId) {
        // (time, user, index into that user's tweets); max-heap on time
        priority_queue<tuple<int, int, int>> heap;
        auto push = [&](int u) {
            auto it = tweets.find(u);
            if (it != tweets.end() && !it->second.empty()) {
                int i = it->second.size() - 1;
                heap.push({it->second[i].first, u, i});
            }
        };
        push(userId);
        if (auto f = follows.find(userId); f != follows.end())
            for (int u : f->second) push(u);
        vector<int> feed;
        while (!heap.empty() && feed.size() < 10) {
            auto [t, u, i] = heap.top();
            heap.pop();
            const auto& list = tweets[u];
            feed.push_back(list[i].second);
            if (i > 0) heap.push({list[i - 1].first, u, i - 1});
        }
        return feed;
    }

    void follow(int followerId, int followeeId) {
        if (followerId != followeeId) follows[followerId].insert(followeeId);
    }

    void unfollow(int followerId, int followeeId) {
        if (auto f = follows.find(followerId); f != follows.end()) f->second.erase(followeeId);
    }
};

int main() {
    Twitter t;
    t.postTweet(1, 501);
    t.follow(1, 2);
    t.postTweet(2, 77);
    t.postTweet(1, 900);
    for (int x : t.getNewsFeed(1)) cout << x << ' ';  // 900 77 501
    cout << '\n';
    t.unfollow(1, 2);
    for (int x : t.getNewsFeed(1)) cout << x << ' ';  // 900 501
    cout << '\n';
    return 0;
}
