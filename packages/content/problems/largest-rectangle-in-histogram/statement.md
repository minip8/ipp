A histogram has `n` adjacent bars of width 1; bar `i` has height `heights[i]`. Return the area of the **largest axis-aligned rectangle** that fits entirely inside the histogram (it may span several adjacent bars, but its height can't exceed any bar it covers).

**Examples**

```
heights = [2, 1, 5, 6, 2, 3]   ->   10     bars 2-3, height 5, width 2
heights = [2, 4]               ->   4
heights = [3, 3, 3, 1]         ->   9      first three bars, height 3
```

**Constraints**

- `1 <= heights.length <= 10^5`
- `0 <= heights[i] <= 10^5`
- The area can exceed 32 bits, so it is returned as a 64-bit integer.
