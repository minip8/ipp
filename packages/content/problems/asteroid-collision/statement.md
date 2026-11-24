Asteroids sit in a row, listed from left to right. For each asteroid, the absolute value is its size and the sign is its direction: positive moves **right**, negative moves **left**. All asteroids move at the same speed.

When a right-moving asteroid meets a left-moving one, they collide: the smaller one explodes; if they are the same size, both explode. Asteroids moving in the same direction never meet, and a left-mover on the left of a right-mover never meets it either (they move apart).

Return the asteroids that remain after all collisions, in their left-to-right order.

**Examples**

```
asteroids = [4, 9, -6]          ->   [4, 9]       9 destroys -6
asteroids = [7, -7]             ->   []           equal sizes: both explode
asteroids = [3, 5, -8, 2]       ->   [-8, 2]      -8 destroys 5 then 3; 2 moves away
asteroids = [-2, -1, 1, 2]      ->   [-2, -1, 1, 2]   no one ever meets
```

**Constraints**

- `2 <= asteroids.length <= 10^4`
- `-1000 <= asteroids[i] <= 1000`, `asteroids[i] != 0`
