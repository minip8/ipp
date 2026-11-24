Koko has `n` piles of bananas; pile `i` contains `piles[i]` bananas. She picks a fixed eating speed of `k` bananas per hour. Each hour she chooses one pile and eats `k` bananas from it; if the pile has fewer than `k` left she finishes it and does nothing else that hour (she never moves on to another pile within the same hour).

So pile `i` takes `ceil(piles[i] / k)` hours. Return the **smallest integer** `k >= 1` that lets her finish every pile within `h` hours in total.

**Examples**

```
piles = [3, 6, 7, 11], h = 8        ->   4      1 + 2 + 2 + 3 = 8 hours; at k = 3 it takes 10
piles = [30, 11, 23, 4, 20], h = 5  ->   30     one hour per pile, so k must cover the largest pile
piles = [30, 11, 23, 4, 20], h = 6  ->   23
```

**Constraints**

- `1 <= piles.length <= 10^4`
- `piles.length <= h <= 10^9` (so an answer always exists)
- `1 <= piles[i] <= 10^9`
