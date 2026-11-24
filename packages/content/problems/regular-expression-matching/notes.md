**Approaches**
- Backtracking: match the first character, and when the next pattern character is `*`, branch on "use the starred element zero times" vs "consume one character and stay on the same pattern position". Correct but exponential in bad cases: `s = "aaaa...ab"`, `p = "a*a*a*...a*c"`.
- Expected: memoise on (i, j) = positions in s and p, or fill a bottom-up table `M[i][j]` = suffix `s[i:]` matches suffix `p[j:]`. O(|s| * |p|) time and space (O(|p|) space with rolling rows).
  - Let `first = i < |s| and p[j] in {s[i], '.'}`.
  - If `p[j+1] == '*'`: `M[i][j] = M[i][j+2] or (first and M[i+1][j])`.
  - Else: `M[i][j] = first and M[i+1][j+1]`.
  - Base: `M[|s|][|p|] = true`; an empty s can still match patterns like `a*b*`.
- An NFA / Thompson construction is the industrial answer; worth discussing but not expected in 45 minutes.

**Common wrong turns**
- Treating `*` as a wildcard on its own (glob semantics) instead of applying it to the preceding element.
- Handling `*` by looking at `p[j]` instead of peeking at `p[j+1]`, which mis-parses patterns like `ab*`.
- Forgetting that `x*` may match zero characters, including when s is exhausted (`s = "a"`, `p = "ab*"` is true).
- Greedy `*` (consume as many as possible and never backtrack): `s = "aaa"`, `p = "a*a"` fails greedily but matches.
- Only matching a prefix of s (returning true when p runs out early).
- Memoising on the string slices rather than indices, which copies O(n) per call.

**Hint ladder**
1. Write the recursion first: compare the first characters, and handle the case where the next pattern character is a star separately.
2. A star gives two choices: skip "x*" entirely, or (if the first character matches) eat one character of s and keep "x*" for more. Why can this blow up?
3. The recursion only ever depends on two indices (position in s, position in p). Cache it.
4. Convert to a table filled from the ends of both strings backward; check the empty-s row carefully.

**Follow-ups**
- Add `+` and `?`.
- Wildcard matching with `?` and `*` (glob) — a different DP with a greedy O(1)-space solution.
- How do real regex engines avoid exponential blow-up (Thompson NFA simulation, RE2) and why do backtracking engines (PCRE, Python `re`) not?
- Return the matched spans for capture groups.
