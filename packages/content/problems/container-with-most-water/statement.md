There are `n` vertical walls standing on a line at positions `0, 1, ..., n-1`; wall `i` has height `height[i]`.

Choose **two** walls `i < j`. Together with the ground they form a container. Water can rise only as high as the shorter of the two walls, so the container holds

```
min(height[i], height[j]) * (j - i)
```

units of water. Walls in between do not get in the way. Return the largest amount that any pair of walls can hold.

**Examples**

```
height = [2, 7, 3, 6, 4, 1]     ->   12     walls 1 and 3 hold min(7, 6) * 2 = 12
                                            (walls 1 and 4 also hold min(7, 4) * 3 = 12)
height = [1, 1]                 ->   1
height = [5, 1, 1, 1, 5]        ->   20     the two outer walls: 5 * 4
```

**Constraints**

- `2 <= height.length <= 10^5`
- `0 <= height[i] <= 10^4`
