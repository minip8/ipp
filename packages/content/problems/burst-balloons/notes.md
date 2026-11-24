**Approaches**
- Brute force: try all n! burst orders (or recurse on the remaining list). Only works for n <= 8 or so. Memoising on the set of remaining balloons is 2^n.
- Key insight: instead of choosing which balloon to burst *first* in a range (which leaves two halves that still interact through shared neighbours), choose which balloon is burst **last** in an open interval. Pad the array with 1 at both ends: `a = [1] + nums + [1]`. For an open interval (i, j), if k is the last balloon burst inside it, then at that moment its neighbours are exactly a[i] and a[j], and the two sides (i, k) and (k, j) are independent.
- Expected: `best[i][j] = max over i < k < j of best[i][k] + a[i]*a[k]*a[j] + best[k][j]`, filled by increasing interval length. O(n^3) time, O(n^2) space. With n = 200 that is ~1.3*10^6 inner steps.

**Common wrong turns**
- Greedy: burst the smallest balloon first, or the one that earns the most now. Both fail: on `[4, 1, 6, 2]` biggest-gain-now earns 82 and smallest-first earns 66 (optimum 84); on `[3, 0, 5, 0, 2]` biggest-gain-now earns 2 (optimum 39).
- DP on "first balloon burst in a range": the subproblems are not independent because after bursting k the left and right parts become neighbours.
- Forgetting the padding 1s, or using closed intervals inconsistently, which produces off-by-one neighbours.
- Filling the table in the wrong order (must go by interval length, or i descending / j ascending).
- Zeros: a 0 balloon is worth bursting early (it gives 0) only if it is a bad neighbour; the DP handles it, greedy rules usually do not.

**Hint ladder**
1. If you pick the first balloon to burst in a segment, are the remaining left and right parts independent? Why not?
2. Flip the question: which balloon in the segment is burst last? Who are its neighbours at that moment?
3. Add a virtual 1 at each end. For an open interval (i, j), try every k as the last balloon burst and combine the two sub-intervals.
4. Fill the table by interval length so that both sub-intervals are already solved.

**Follow-ups**
- Reconstruct an optimal order.
- Same "last operation" trick appears in matrix-chain multiplication, minimum cost to merge stones, minimum score triangulation of a polygon; ask the candidate to see the link.
- Can it be done faster than O(n^3)? (Knuth's optimisation does not apply directly here; worth discussing why.)
