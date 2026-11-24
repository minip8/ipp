**Approaches**
- Brute force: try every subset with no two adjacent (or recurse take/skip without memo). Exponential; dies around n = 40.
- Expected: `best(i) = max(best(i-1), best(i-2) + nums[i])`. O(n) time; O(1) space with two rolling variables.
- Equivalent state machine: `take` / `skip` values for the current house.

**Common wrong turns**
- Greedy choices: "take all even indices or all odd indices" fails on `[5, 1, 1, 5]` (answer 10 picks indices 0 and 3). "Always take the largest remaining house" also fails (`[3, 4, 3]` -> 6, not 4).
- Base cases for n = 1 and n = 2 (with a table indexed from 0, `best(1) = max(nums[0], nums[1])`).
- Recursion without memoisation: correct but exponential; with n = 3 * 10^4, recursive memoisation also overflows the default Python recursion limit, so push for the iterative form.

**Hint ladder**
1. Look at the last house. In an optimal plan, is it robbed or not? What does each choice leave you with?
2. If it is robbed, the house before it is off limits; if not, you face the same problem on one fewer house.
3. Define `best(i)` = the answer for the first i houses and write it in terms of smaller prefixes.
4. You only need the previous two values of `best`.

**Follow-ups**
- Houses are in a circle (first and last are adjacent): run the linear solution twice, excluding the first or the last house.
- Return which houses to rob, not just the total (keep choices and backtrack).
- Houses form a tree (parent/child adjacency): DFS returning (with, without) for each subtree.
- Negative values? (then "choose nothing" matters; the recurrence still works because of the max with skip)
