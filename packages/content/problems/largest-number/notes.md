**Approaches**
- Brute force: try all permutations — O(n! * n). Only for tiny inputs.
- Expected: sort the numbers as strings with the comparator "a goes before b if `a + b > b + a`", then concatenate. O(n log n) comparisons, each O(digits). Strip to `"0"` if the first element is `"0"`.
- The interesting discussion: why is this comparator a valid strict weak ordering (transitive)? Sketch: compare `a·10^|b| + b` vs `b·10^|a| + a`, i.e. `a / (10^|a| - 1)` vs `b / (10^|b| - 1)` — a fixed key per string, hence transitive.

**Common wrong turns**
- Plain lexicographic descending sort: `["3", "30"]` gives `"303"` instead of `"330"`.
- Numeric descending sort: `[10, 2]` gives `"102"`.
- Returning `"000"` for all zeros.
- In C++, a comparator that returns `true` for equal elements (`>=`) breaks `std::sort` (UB). Use strict `>`.
- In Python 3, `sort(cmp=...)` doesn't exist; need `functools.cmp_to_key`.

**Hint ladder**
1. For just two numbers `a` and `b`, how do you decide which should come first?
2. Can you turn that pairwise decision into a sort?
3. Sort by comparing the two possible concatenations, then deal with the all-zeros case.

**Follow-ups**
- Prove transitivity of the comparator.
- Smallest number instead (careful with leading zeros: which arrangements are even valid?).
- Very large n: can you avoid allocating `a + b` strings in each comparison?
