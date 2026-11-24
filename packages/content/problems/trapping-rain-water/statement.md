`height` describes an elevation map made of bars of width 1: bar `i` has height `height[i]`. After heavy rain, water collects in the dips between bars. Water above a position cannot escape if there are taller bars somewhere on **both** sides of it; it spills over the lower of those two sides.

Return the **total units of water** trapped. (Water can't be held at the very first or last position, since one side is open.)

**Examples**

```
height = [3, 0, 2, 0, 4]                 ->   7      3 + 1 + 3 units above positions 1, 2, 3
height = [0, 1, 0, 2, 1, 0, 1, 3, 2, 1, 2, 1]  ->   6
height = [5, 4, 3]                       ->   0      nothing on the right to hold water
```

**Constraints**

- `1 <= height.length <= 2 * 10^5`
- `0 <= height[i] <= 10^5`
- The total can exceed 32 bits, so it is returned as a 64-bit integer.
