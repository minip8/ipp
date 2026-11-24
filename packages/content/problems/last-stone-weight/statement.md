You have a pile of stones with positive integer weights `stones[i]`. Repeat the following while at least two stones remain:

- Take the two **heaviest** stones, with weights `x <= y`.
- If `x == y`, both are destroyed.
- Otherwise the lighter one is destroyed and the heavier one is replaced by a stone of weight `y - x`, which goes back into the pile.

Return the weight of the stone left at the end, or `0` if no stones are left.

**Examples**

```
stones = [3, 8, 4, 1, 5]   ->   1
```
Smash 8 and 5 -> 3, pile `[3, 4, 1, 3]`. Smash 4 and 3 -> 1, pile `[3, 1, 1]`. Smash 3 and 1 -> 2, pile `[1, 2]`. Smash 2 and 1 -> 1, pile `[1]`.

```
stones = [6, 6]   ->   0
stones = [9]      ->   9
```

**Constraints**

- `1 <= stones.length <= 2 * 10^4`
- `1 <= stones[i] <= 1000`
